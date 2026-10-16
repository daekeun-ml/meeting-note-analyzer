// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ listLectures: vi.fn(), listMeetings: vi.fn(), listInterviews: vi.fn() }));
vi.mock("../api", () => ({ useApi: () => api }));
import { LecturesPage } from "../../pages/LecturesPage";
import { MeetingsPage } from "../../pages/MeetingsPage";
import { InterviewsPage } from "../../pages/InterviewsPage";

let element: HTMLDivElement, root: Root, client: QueryClient;
const records = (count: number) => Array.from({ length: count }, (_, i) => ({
  lectureId: `l${i + 1}`, meetingId: `m${i + 1}`, interviewId: `i${i + 1}`, title: `항목 ${i + 1}`,
  status: "COMPLETED", course: "ML", createdAt: "2026-10-16", stages: {},
  settings: { targetLevel: "L6", roleTitle: "Engineer", criteria: ["domain_depth"] },
}));
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); client.clear(); });
function Detail() { const navigate = useNavigate(); return <button onClick={() => navigate(-1)}>목록으로 돌아가기</button>; }
async function render(path: string) {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/lectures" element={<LecturesPage />} /><Route path="/meetings" element={<MeetingsPage />} /><Route path="/interviews" element={<InterviewsPage />} />
    <Route path="/lectures/:id" element={<Detail />} />
  </Routes></MemoryRouter></QueryClientProvider>));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}
function topNav() { return element.querySelector("nav")!; }
function titles() { return [...element.querySelectorAll("h2")].map((node) => node.textContent); }
async function click(label: string) {
  const button = [...topNav().querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label || b.textContent === label)!;
  expect(button.disabled).toBe(false);
  await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 10)); });
}
function batches(method: ReturnType<typeof vi.fn>, count: number) {
  const items = records(count);
  method.mockImplementation(async (cursor?: string) => {
    const offset = Number(cursor) || 0;
    return { items: items.slice(offset, offset + 25), cursor: offset + 25 < items.length ? String(offset + 25) : null };
  });
}

it.each([
  ["/lectures", "listLectures"], ["/meetings", "listMeetings"], ["/interviews", "listInterviews"],
] as const)("shows ten records per page at %s and handles cursor batches without gaps", async (path, method) => {
  batches(api[method], 52);
  await render(path);
  expect(element.querySelector<HTMLSelectElement>('select[aria-label="페이지당 항목 수"]')?.value).toBe("10");
  expect(titles()).toEqual(records(10).map((record) => record.title));
  await click("2페이지");
  expect(titles()).toEqual(records(20).slice(10).map((record) => record.title));
  expect(api[method]).toHaveBeenCalledTimes(1); // The API already returned 25 records.
  await click("다음");
  expect(titles()).toEqual(records(30).slice(20).map((record) => record.title));
  expect(api[method]).toHaveBeenLastCalledWith("25");
  await click("다음"); await click("다음"); await click("다음");
  expect(titles()).toEqual(["항목 51", "항목 52"]);
  expect(topNav().textContent).toContain("총 52개");
  expect([...topNav().querySelectorAll("button")].find((button) => button.textContent === "다음")?.disabled).toBe(true);
  await click("이전");
  expect(titles()).toEqual(records(50).slice(40).map((record) => record.title));
  expect(api[method]).toHaveBeenCalledTimes(3);
});

it("changes page size, fills across batches, and restores the selection after opening a lecture", async () => {
  batches(api.listLectures, 52);
  await render("/lectures");
  const select = element.querySelector<HTMLSelectElement>('select[aria-label="페이지당 항목 수"]')!;
  await act(async () => { select.value = "20"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  await click("다음");
  expect(titles()).toEqual(records(40).slice(20).map((record) => record.title));
  await act(async () => element.querySelector("h2")!.closest("button")!.click());
  await act(async () => element.querySelector("button")!.click());
  expect(titles()).toEqual(records(40).slice(20).map((record) => record.title));
  expect(element.querySelector<HTMLSelectElement>('select[aria-label="페이지당 항목 수"]')?.value).toBe("20");
  expect(topNav().querySelector('[aria-current="page"]')?.textContent).toBe("2");
});

it("keeps the current page on a failed request and retries without appending cards", async () => {
  const items = records(32);
  api.listLectures.mockResolvedValueOnce({ items: items.slice(0, 25), cursor: "25" })
    .mockRejectedValueOnce(new Error("Temporary list failure"))
    .mockResolvedValueOnce({ items: items.slice(25), cursor: null });
  await render("/lectures"); await click("2페이지"); await click("다음");
  expect(titles()).toEqual(items.slice(10, 20).map((record) => record.title));
  expect(element.textContent).toContain("Temporary list failure");
  await click("다음");
  expect(titles()).toEqual(items.slice(20, 30).map((record) => record.title));
});

it("does not create an empty last page when the API's final cursor has no more records", async () => {
  api.listLectures.mockResolvedValueOnce({ items: records(10), cursor: "end" })
    .mockResolvedValueOnce({ items: [], cursor: null });
  await render("/lectures"); await click("다음");
  expect(titles()).toHaveLength(10);
  expect(topNav().querySelector('[aria-current="page"]')?.textContent).toBe("1");
  expect(topNav().textContent).toContain("총 10개");
});

it("moves to the last valid page when a refresh removes the current page", async () => {
  batches(api.listLectures, 23);
  await render("/lectures"); await click("3페이지");
  await act(async () => client.setQueryData(["lectures", "paged-list"], { pages: [{ items: records(10), cursor: null }], pageParams: [undefined] }));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(titles()).toHaveLength(10);
  expect(topNav().querySelector('[aria-current="page"]')?.textContent).toBe("1");
});
