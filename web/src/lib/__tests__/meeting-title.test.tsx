// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MeetingResultResponse } from "@meeting-notes/shared";

const api = vi.hoisted(() => ({ getResult: vi.fn(), updateMeeting: vi.fn() }));
vi.mock("../api", () => ({ useApi: () => api }));
import { MeetingPage } from "../../pages/MeetingPage";

let root: Root; let element: HTMLDivElement; let client: QueryClient; let current: MeetingResultResponse;
beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Still processing: the title must be editable before any document exists.
  current = { meeting: { meetingId: "m1", title: "주간 회의", status: "ANALYZING", stages: {}, createdAt: "2026-09-09" }, notes: null, transcriptUrl: null, audioUrl: null, notesMarkdownUrl: null } as unknown as MeetingResultResponse;
  api.getResult.mockImplementation(async () => current);
  api.updateMeeting.mockImplementation(async (_id: string, body: { title: string }) => { current = { ...current, meeting: { ...current.meeting, title: body.title } }; return { meeting: current.meeting }; });
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); client.clear(); });
async function render() {
  client.setQueryData(["meeting", "m1"], current);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/meetings/m1"]}><Routes><Route path="/meetings/:id" element={<MeetingPage />} /></Routes></MemoryRouter></QueryClientProvider>));
}
function button(label: string) { return [...element.querySelectorAll("button")].find((b) => b.textContent?.includes(label) || b.getAttribute("aria-label") === label)!; }
function titleInput() { return element.querySelector<HTMLInputElement>("input[aria-label='회의 제목']"); }
async function type(value: string) {
  const input = titleInput()!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  await act(async () => input.dispatchEvent(new Event("input", { bubbles: true })));
}
async function settle() {
  await vi.waitFor(async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); expect(titleInput()).toBeNull(); });
}

it("renames the meeting from the heading while it is still processing", async () => {
  await render();
  expect(element.querySelector("h1")?.textContent).toBe("주간 회의");
  await act(async () => button("제목 바꾸기").click());
  expect(titleInput()?.value).toBe("주간 회의");
  await type("  9월 2주차 주간 회의 ");
  await act(async () => button("저장").click());
  await settle();
  expect(api.updateMeeting).toHaveBeenCalledWith("m1", { title: "9월 2주차 주간 회의" });
  expect(element.querySelector("h1")?.textContent).toBe("9월 2주차 주간 회의");
});
it("saves with Enter and cancels with Escape", async () => {
  await render();
  await act(async () => button("제목 바꾸기").click());
  await type("버릴 제목");
  await act(async () => titleInput()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(titleInput()).toBeNull();
  expect(api.updateMeeting).not.toHaveBeenCalled();
  expect(element.querySelector("h1")?.textContent).toBe("주간 회의");
  await act(async () => button("제목 바꾸기").click());
  await type("확정 제목");
  await act(async () => titleInput()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await settle();
  expect(api.updateMeeting).toHaveBeenCalledWith("m1", { title: "확정 제목" });
});
it("keeps the editor open and shows the error when saving fails", async () => {
  api.updateMeeting.mockRejectedValueOnce(new Error("제목이 너무 깁니다"));
  await render();
  await act(async () => button("제목 바꾸기").click());
  await type("실패할 제목");
  await act(async () => button("저장").click());
  await vi.waitFor(() => expect(element.textContent).toContain("제목이 너무 깁니다"));
  expect(titleInput()?.value).toBe("실패할 제목");
  expect(element.querySelector("h1")).toBeNull();
});
