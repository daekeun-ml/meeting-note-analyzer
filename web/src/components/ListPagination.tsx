import { LIST_PAGE_SIZES, type ListPageSize } from "../lib/use-paged-list";
import { Button } from "./ui";

interface Props {
  label: string; bottom?: boolean;
  pagination: {
    page: number; pageSize: ListPageSize; availablePages: number; total?: number; first: number; last: number;
    hasPrevious: boolean; hasNext: boolean; busy: boolean;
    goTo: (page: number) => Promise<void>; setPageSize: (size: ListPageSize) => Promise<void>;
  };
}
export function ListPagination({ label, pagination: p, bottom = false }: Props) {
  const start = Math.max(1, Math.min(p.page - 2, p.availablePages - 4));
  const numbers = Array.from({ length: Math.min(5, p.availablePages) }, (_, i) => start + i);
  return <nav aria-label={`${label} ${bottom ? "하단 " : ""}페이지 이동`} className={bottom ? "mt-5 space-y-3" : "mb-4 space-y-3"}>
    {!bottom && <div className="flex items-center justify-between gap-2">
      <p className="text-xs text-ink-3" aria-live="polite">{p.first}–{p.last}개{p.total !== undefined ? ` / 총 ${p.total}개` : ""}</p>
      <label className="flex items-center gap-2 text-xs text-ink-3">페이지당
        <select aria-label="페이지당 항목 수" value={p.pageSize} disabled={p.busy} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink"
          onChange={(event) => void p.setPageSize(Number(event.target.value) as ListPageSize)}>
          {LIST_PAGE_SIZES.map((size) => <option value={size} key={size}>{size}개</option>)}
        </select>
      </label>
    </div>}
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      <Button size="sm" variant="secondary" disabled={!p.hasPrevious || p.busy} onClick={() => void p.goTo(p.page - 1)}>이전</Button>
      {numbers.map((page) => <button key={page} type="button" aria-label={`${page}페이지`} aria-current={p.page === page ? "page" : undefined}
        disabled={p.busy} onClick={() => void p.goTo(page)}
        className={`tap grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm disabled:opacity-50 ${p.page === page ? "bg-accent text-white font-semibold" : "bg-surface text-ink-2"}`}>{page}</button>)}
      <Button size="sm" variant="secondary" disabled={!p.hasNext || p.busy} onClick={() => void p.goTo(p.page + 1)}>다음</Button>
    </div>
    {p.busy && <p role="status" className="text-center text-xs text-ink-3">목록 불러오는 중…</p>}
  </nav>;
}
