// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { briefToMarkdown, type MeetingResultResponse, type NotesDocument } from "@meeting-notes/shared";

const api = vi.hoisted(() => ({ getResult: vi.fn(), retryMeeting: vi.fn(), createMeetingBrief: vi.fn() }));
vi.mock("../api", () => ({ useApi: () => api }));
import { MeetingPage } from "../../pages/MeetingPage";

const doc = (): NotesDocument => ({
  meetingId: "m1", summary: { headline: "상세 요약 제목", overview: "원래의 상세 개요", keyDecisions: ["핵심 기능부터 출시"], keyDiscussions: [], risksAndIssues: [], nextSteps: [] },
  speakers: [{ id: "S1", label: "수정된 이름" }], topics: [], agenda: [{ id: "A1", title: "출시 범위", decisions: ["핵심 기능부터 출시"], discussionPoints: [], openQuestions: [] }], notes: { sections: [{ title: "상세 노트", bullets: ["기존 내용"] }] },
  followUps: [{ id: "F1", title: "업로드 테스트", ownerSpeakerId: "S1", priority: "high" }],
  brief: { headline: "추가 요약의 핵심 결론", decisions: [{ agendaId: "A1", decisionIndex: 0, decision: "핵심 기능부터 출시", process: "테스트 기간이 부족해 단계별 출시를 선택했다.", rationaleStatus: "supported", evidenceSegmentIds: ["seg-0001"], evidence: [{ segmentId: "seg-0001", start: 63, speaker: "S1", text: "테스트 시간이 부족합니다." }] }, { agendaId: "A1", decisionIndex: 1, decision: "통계는 다음 버전", process: "표시하면 안 되는 추측", rationaleStatus: "not_recorded", evidenceSegmentIds: [], evidence: [] }], followUpIds: ["F1"], openQuestions: [{ agendaId: "A1", questionIndex: 0, question: "출시일 확정" }], omittedCounts: { decisions: 1, followUps: 1, openQuestions: 0 } },
  outputLanguage: "ko",
} as unknown as NotesDocument);
let root: Root; let element: HTMLDivElement; let client: QueryClient; let current: MeetingResultResponse;
const writeText = vi.fn(); const scrollIntoView = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  current = { meeting: { meetingId: "m1", title: "주간 회의", status: "COMPLETED", stages: {}, createdAt: "2026-09-05" }, notes: doc(), transcriptUrl: null, audioUrl: null, notesMarkdownUrl: null } as unknown as MeetingResultResponse;
  api.getResult.mockImplementation(async () => current); api.createMeetingBrief.mockResolvedValue({ executionArn: "exec" }); writeText.mockResolvedValue(undefined);
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); client.clear(); });
async function render() {
  client.setQueryData(["meeting", "m1"], current);
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/meetings/m1"]}><Routes><Route path="/meetings/:id" element={<MeetingPage />} /></Routes></MemoryRouter></QueryClientProvider>));
}
function button(label: string) { return [...element.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!; }

it("appends the recap after the original details and exposes decision evidence", async () => {
  await render();
  expect(element.textContent!.indexOf("원래의 상세 개요")).toBeLessThan(element.textContent!.indexOf("한눈에 보는 요약"));
  expect(element.textContent).toContain("테스트 기간이 부족해 단계별 출시");
  expect(element.textContent).toContain("결정 근거 미확인");
  expect(element.textContent).not.toContain("표시하면 안 되는 추측");
  expect(element.querySelector("#meeting-brief details")?.textContent).toContain("1:03 · 수정된 이름");
  expect(element.querySelector("#meeting-brief details")?.hasAttribute("open")).toBe(false);
  expect(element.textContent).toContain("기한 미정");
});
it("jumps to the recap from another tab and copies only the compact content", async () => {
  await render();
  await act(async () => button("안건").click());
  await act(async () => button("핵심 요약 보기").click());
  expect(scrollIntoView).toHaveBeenCalled();
  expect(document.activeElement?.id).toBe("meeting-brief");
  await act(async () => button("요약 복사").click());
  expect(writeText).toHaveBeenCalledWith(briefToMarkdown(current.notes as NotesDocument));
  expect(writeText.mock.calls[0]![0]).not.toContain("원래의 상세 개요");
});
it("links omitted actions to the full follow-up view and reports clipboard failure", async () => {
  await render(); writeText.mockRejectedValueOnce(new Error("denied"));
  await act(async () => button("요약 복사").click());
  expect(element.textContent).toContain("복사하지 못했습니다");
  await act(async () => button("할 일 1개 더 보기").click());
  expect(element.querySelector("#meeting-brief")).toBeNull();
  expect(element.textContent).toContain("업로드 테스트");
});
it("lets older meetings request a brief explicitly without retrying the original pipeline", async () => {
  (current.notes as NotesDocument).brief = undefined;
  api.createMeetingBrief.mockImplementation(async () => { current = { ...current, meeting: { ...current.meeting, briefStatus: "RUNNING" } }; return { executionArn: "exec" }; }); // the API records the running job
  await render();
  expect(api.createMeetingBrief).not.toHaveBeenCalled();
  await act(async () => button("추가 요약 만들기").click());
  expect(api.createMeetingBrief).toHaveBeenCalledWith("m1");
  expect(api.retryMeeting).not.toHaveBeenCalled();
  // React Query batches the result notification onto a later task.
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(element.textContent).toContain("추가 요약을 만들고 있습니다");
  });
  expect(element.textContent).toContain("원래의 상세 개요");
});
it("shows empty sections truthfully for meetings without decisions or tasks", async () => {
  (current.notes as NotesDocument).brief = { headline: "진행 상황을 공유했고 결정은 보류했다.", decisions: [], followUpIds: [], openQuestions: [], omittedCounts: { decisions: 0, followUps: 0, openQuestions: 0 } };
  await render();
  expect(element.textContent).toContain("확정된 결정 사항이 없습니다");
  expect(element.textContent).toContain("기록된 후속 조치가 없습니다");
});
it("shows a failed brief as retryable while the meeting itself stays completed", async () => {
  (current.notes as NotesDocument).brief = undefined;
  current = { ...current, meeting: { ...current.meeting, briefOnly: true, briefStatus: "FAILED", briefError: "StageError: rejected" } };
  await render();
  expect(element.textContent).toContain("추가 요약을 완료하지 못했습니다");
  expect(element.textContent).toContain("원래의 상세 개요");
  expect(button("추가 요약 만들기")).toBeDefined();
  expect(element.textContent).not.toContain("회의 분석에 실패");
});

it("lets a long unbroken meeting title wrap instead of widening the page", async () => {
  current = { ...current, meeting: { ...current.meeting, title: "2026-09-08_주간회의_결제모듈_PG사_타임아웃_대응_및_엑셀_익스포트_우선순위_조정_회의록_최종본_v3_공유용" } };
  await render();
  const title = element.querySelector("h1")!;
  expect(title.className).toContain("min-w-0");
  expect(title.className).toContain("[overflow-wrap:anywhere]");
  expect(title.parentElement?.querySelector(".shrink-0")).not.toBeNull(); // the status chip keeps its width, the title gives way
});
