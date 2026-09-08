import { beforeEach, expect, it, vi } from "vitest";
import { STAGES, type NotesDocument } from "@meeting-notes/shared";

const backend = vi.hoisted(() => ({ getMeeting: vi.fn(), readJson: vi.fn(), putFinalDocument: vi.fn(), notifyUser: vi.fn() }));
const updateMeeting = vi.hoisted(() => vi.fn());
vi.mock("@meeting-notes/backend", async (original) => ({ ...await original<typeof import("@meeting-notes/backend")>(), ...backend }));
vi.mock("../src/lib/meeting-updates.js", () => ({ updateMeeting, setStatus: vi.fn() }));
vi.mock("../src/lib/env.js", () => ({ pipelineEnv: { memoryId: "", webOrigin: "https://example.test" } }));
import { handler as register } from "../src/handlers/register-upload.js";
import { handler as finalize } from "../src/handlers/finalize.js";
import { handler as markFailed } from "../src/handlers/mark-failed.js";
import { resumePlan } from "../src/lib/resume.js";

const record = { meetingId: "m1", owner: "u1", title: "회의", status: "COMPLETED", notesKey: "results/m1/document.json", transcriptKey: "transcripts/m1/transcript.json", outputLanguage: "ko", completedAt: "2026-09-05T00:00:00Z", stages: {} };
beforeEach(() => {
  vi.resetAllMocks();
  backend.getMeeting.mockResolvedValue({ ...record });
  backend.putFinalDocument.mockResolvedValue({ notesKey: record.notesKey });
  backend.notifyUser.mockResolvedValue({ delivered: 1 });
});

it("registers old meetings at the brief stage while the published meeting stays COMPLETED", async () => {
  const out = await register({ retry: { meetingId: "m1", briefOnly: true }, executionArn: "exec1" });
  expect(out).toMatchObject({ proceed: true, briefOnly: true, documentKey: record.notesKey, transcriptKey: record.transcriptKey });
  const [, fields, condition, remove] = updateMeeting.mock.calls[0]!;
  expect(fields).toEqual({ currentStage: "meeting_brief", briefOnly: true, briefStatus: "RUNNING", briefExecutionArn: "exec1" });
  expect(condition).toMatchObject({ values: { ":expected": "COMPLETED" } });
  expect(remove).toEqual(["error", "retryToken", "briefError"]);
});
it("declines a brief on a meeting still being analyzed and releases the request token", async () => {
  backend.getMeeting.mockResolvedValueOnce({ ...record, status: "ANALYZING" });
  expect(await register({ retry: { meetingId: "m1", briefOnly: true }, executionArn: "duplicate" })).toMatchObject({ proceed: false });
  expect(updateMeeting).toHaveBeenCalledWith("m1", {}, undefined, ["retryToken"]);
});
it("a failed brief keeps the meeting COMPLETED and can be requested again", async () => {
  backend.getMeeting.mockResolvedValueOnce({ ...record, briefOnly: true, briefStatus: "RUNNING", stages: { meeting_brief: { status: "RUNNING" } } });
  await markFailed({ meetingId: "m1", errorOutput: { Error: "StageError", Cause: "rejected" } });
  const [, fields, , remove] = updateMeeting.mock.calls[0]!;
  expect(fields).toMatchObject({ briefStatus: "FAILED", briefError: expect.stringContaining("StageError") });
  expect(fields).not.toHaveProperty("status");
  expect(remove).toEqual(["briefExecutionArn"]);
  expect(backend.notifyUser.mock.calls[0]![1]).toMatchObject({ title: "추가 요약 생성에 실패했습니다" });
  updateMeeting.mockClear();
  backend.getMeeting.mockResolvedValueOnce({ ...record, briefOnly: true, briefStatus: "FAILED", briefError: "StageError: rejected" });
  expect(await register({ retry: { meetingId: "m1", briefOnly: true }, executionArn: "exec2" })).toMatchObject({ proceed: true, briefOnly: true });
});
it("preserves current published content and renamed speakers when attaching the brief", async () => {
  const previous = { meetingId: "m1", title: "회의", generatedAt: "old-date", speakers: [{ id: "S1", label: "수정한 이름" }], followUps: [{ id: "F1", ownerName: "수정한 이름" }], notes: { markdown: "수정한 상세 기록" } } as unknown as NotesDocument;
  const brief = { headline: "추가 결론", decisions: [], followUpIds: ["F1"], openQuestions: [], omittedCounts: { decisions: 0, followUps: 0, openQuestions: 0 } };
  backend.readJson.mockImplementation(async (key) => key === record.notesKey ? previous : key === "results/m1/meeting_brief.json" ? brief : null);
  await finalize({ meetingId: "m1", ownerSub: "u1", title: "회의", outputLanguage: "ko", transcriptKey: record.transcriptKey, briefOnly: true, expectBrief: true });
  expect(backend.putFinalDocument).toHaveBeenCalledWith("u1", { ...previous, brief });
  expect(backend.readJson.mock.calls.map(([key]) => key)).toEqual([record.notesKey, "results/m1/meeting_brief.json"]);
  expect(updateMeeting).toHaveBeenCalledWith("m1", expect.objectContaining({ status: "COMPLETED", completedAt: record.completedAt }), undefined, ["briefOnly", "briefStatus", "briefError", "briefExecutionArn"]);
});
it("never replaces a published document when the new brief is missing", async () => {
  backend.readJson.mockResolvedValue(null);
  await expect(finalize({ meetingId: "m1", ownerSub: "u1", title: "회의", outputLanguage: "ko", transcriptKey: record.transcriptKey, briefOnly: true })).rejects.toThrow("missing");
  expect(backend.putFinalDocument).not.toHaveBeenCalled();
});
it("does not fail a published brief or rerun analysis when notification delivery fails", async () => {
  backend.readJson.mockImplementation(async (key) => key === record.notesKey ? { meetingId: "m1", speakers: [] } : { headline: "완성된 추가 요약" });
  backend.notifyUser.mockRejectedValueOnce(new Error("push unavailable"));
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const result = await finalize({ meetingId: "m1", ownerSub: "u1", title: "회의", outputLanguage: "ko", transcriptKey: record.transcriptKey, briefOnly: true });
    expect(result.push).toMatchObject({ failed: true });
    expect(updateMeeting).toHaveBeenCalledTimes(1);
    expect(updateMeeting.mock.calls[0]![1]).toMatchObject({ status: "COMPLETED" });
  } finally { warning.mockRestore(); }
});
it("runs the new stage after all detailed stages and resumes there after a brief failure", () => {
  expect(STAGES.at(-1)).toBe("meeting_brief");
  const stages = Object.fromEntries(["stt", ...STAGES.filter((s) => s !== "meeting_brief")].map((s) => [s, { status: "COMPLETED", s3Key: `results/m1/${s}.json` }]));
  expect(resumePlan({ ...record, stages } as never).firstStage).toBe("meeting_brief");
});
