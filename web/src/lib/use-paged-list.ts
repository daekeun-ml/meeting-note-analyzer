import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";

export const LIST_PAGE_SIZES = [10, 20, 50] as const;
export type ListPageSize = (typeof LIST_PAGE_SIZES)[number];
type ListPage<T> = { items: T[]; cursor?: string | null };
type View = { index: number; size: ListPageSize };

/** Display pages are independent of the API's cursor-batch size. */
export function usePagedList<T>(name: string, fetchPage: (cursor?: string) => Promise<ListPage<T>>, active: (item: T) => boolean) {
  const client = useQueryClient();
  const viewKey = useMemo(() => [name, "list-view"], [name]);
  const [view, setView] = useState<View>(() => client.getQueryData<View>(viewKey) ?? { index: 0, size: 10 });
  const [moving, setMoving] = useState(false), [navigationError, setNavigationError] = useState<Error | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const query = useInfiniteQuery({
    queryKey: [name, "paged-list"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    getNextPageParam: (last) => last.cursor ?? undefined,
    refetchInterval: (q) => q.state.data?.pages.some((page) => page.items.some(active)) ? 8000 : false,
  });
  const all = query.data?.pages.flatMap((page) => page.items) ?? [];
  const index = Math.min(view.index, Math.max(0, Math.ceil(all.length / view.size) - 1));
  const items = all.slice(index * view.size, (index + 1) * view.size);
  const hasMore = !!query.data?.pages.at(-1)?.cursor;
  const total = query.data && !hasMore ? all.length : undefined;
  useEffect(() => {
    if (query.data && !query.isFetching && index !== view.index) {
      const selected = { ...view, index };
      setView(selected); client.setQueryData(viewKey, selected);
    }
  }, [query.data, query.isFetching, index, view, client, viewKey]);

  async function goTo(requested: number, size: ListPageSize = view.size) {
    if (lock.current || query.isFetching || !LIST_PAGE_SIZES.includes(size)) return;
    // Allow cached pages and at most the next not-yet-loaded display page.
    const next = Math.max(0, Math.min(requested, Math.ceil(all.length / size)));
    lock.current = true; setMoving(true); setNavigationError(null);
    try {
      let data = query.data;
      let count = data?.pages.reduce((n, page) => n + page.items.length, 0) ?? 0;
      const seen = new Set<string>();
      // A display page can span API batches, e.g. rows 21–30 across a 25-row response.
      while (count < (next + 1) * size && data?.pages.at(-1)?.cursor) {
        const cursor = data.pages.at(-1)!.cursor!;
        if (seen.has(cursor)) throw new Error("목록을 이어서 불러오지 못했습니다. 다시 시도해 주세요.");
        seen.add(cursor);
        const result = await query.fetchNextPage({ cancelRefetch: false });
        if (result.isError) throw result.error;
        data = result.data;
        count = data?.pages.reduce((n, page) => n + page.items.length, 0) ?? 0;
      }
      if (!mounted.current) return;
      const selected = { index: Math.min(next, Math.max(0, Math.ceil(count / size) - 1)), size };
      setView(selected); client.setQueryData(viewKey, selected);
      document.querySelector(".app-shell > main")?.scrollTo?.({ top: 0, behavior: "smooth" });
    } catch (error) {
      setNavigationError(error instanceof Error ? error : new Error("목록을 불러오지 못했습니다."));
    } finally { lock.current = false; setMoving(false); }
  }

  return {
    query, items, error: navigationError ?? query.error,
    page: index + 1, pageSize: view.size, total,
    availablePages: Math.max(1, Math.ceil(all.length / view.size)),
    first: items.length ? index * view.size + 1 : 0, last: index * view.size + items.length,
    hasPrevious: index > 0, hasNext: (index + 1) * view.size < all.length || hasMore,
    busy: moving || query.isFetching,
    goTo: (page: number) => goTo(page - 1),
    setPageSize: (size: ListPageSize) => goTo(0, size),
  };
}
