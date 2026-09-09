import { beforeEach, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ getMeeting: vi.fn(), readJson: vi.fn(), putFinalDocument: vi.fn(), setMeetingTitle: vi.fn() }));
vi.mock("@meeting-notes/backend", async (original) => ({ ...await original<typeof import("@meeting-notes/backend")>(), withDocumentLock: async (_id: string, operation: () => Promise<unknown>) => operation(), ...backend }));
vi.mock("../src/lib/env.js", () => ({ apiEnv: { stateMachineArn: "arn:aws:states:us-east-1:123456789012:stateMachine:meetings" } }));
import { updateMeetingSchema, updateMeetingTitle } from "../src/routes/meetings.js";

const meeting = { PK: "MEETING#m1", SK: "META", GSI1PK: "USER#u1", GSI1SK: "2026-09-09", meetingId: "m1", owner: "u1", title: "이전 제목", status: "COMPLETED", notesKey: "results/m1/document.json", stages: {}, createdAt: "2026-09-09", updatedAt: "2026-09-09" };
beforeEach(() => {
  vi.resetAllMocks();
  backend.getMeeting.mockResolvedValue({ ...meeting });
  backend.readJson.mockResolvedValue({ meetingId: "m1", title: "이전 제목", speakers: [] });
  backend.putFinalDocument.mockResolvedValue({ notesKey: meeting.notesKey });
  backend.setMeetingTitle.mockResolvedValue(undefined);
});

it("trims the title and rejects blank or overlong ones", () => {
  expect(updateMeetingSchema.parse({ title: "  주간 회의  " })).toEqual({ title: "주간 회의" });
  expect(updateMeetingSchema.safeParse({ title: "   " }).success).toBe(false);
  expect(updateMeetingSchema.safeParse({ title: "가".repeat(201) }).success).toBe(false);
});
it("renames a finished meeting in the record and in the published document", async () => {
  const result = await updateMeetingTitle({ sub: "u1" }, "m1", { title: "새 제목" });
  expect(result.meeting).toMatchObject({ meetingId: "m1", title: "새 제목" });
  expect(result.meeting).not.toHaveProperty("PK");
  expect(backend.putFinalDocument).toHaveBeenCalledWith("u1", expect.objectContaining({ meetingId: "m1", title: "새 제목" }), meeting.notesKey);
  expect(backend.setMeetingTitle).toHaveBeenCalledWith("m1", "새 제목");
});
it("renames a meeting that is still processing without touching documents", async () => {
  backend.getMeeting.mockResolvedValue({ ...meeting, status: "ANALYZING", notesKey: undefined });
  await updateMeetingTitle({ sub: "u1" }, "m1", { title: "새 제목" });
  expect(backend.readJson).not.toHaveBeenCalled();
  expect(backend.putFinalDocument).not.toHaveBeenCalled();
  expect(backend.setMeetingTitle).toHaveBeenCalledWith("m1", "새 제목");
});
it("republishes derivatives on an idempotent retry after a partial storage failure", async () => {
  const result = await updateMeetingTitle({ sub: "u1" }, "m1", { title: "이전 제목" });
  expect(result.meeting.title).toBe("이전 제목");
  expect(backend.putFinalDocument).toHaveBeenCalledWith("u1", expect.objectContaining({ title: "이전 제목" }), meeting.notesKey);
  expect(backend.setMeetingTitle).toHaveBeenCalledWith("m1", "이전 제목");
});
it("rejects other users without writing anything", async () => {
  await expect(updateMeetingTitle({ sub: "u2" }, "m1", { title: "새 제목" })).rejects.toMatchObject({ status: 404 });
  expect(backend.readJson).not.toHaveBeenCalled();
  expect(backend.setMeetingTitle).not.toHaveBeenCalled();
});
it("leaves the record untouched when the document cannot be rewritten", async () => {
  backend.putFinalDocument.mockRejectedValueOnce(new Error("unavailable"));
  await expect(updateMeetingTitle({ sub: "u1" }, "m1", { title: "새 제목" })).rejects.toThrow("unavailable");
  expect(backend.setMeetingTitle).not.toHaveBeenCalled();
});
it("updates the key recorded on a legacy meeting instead of creating an unreferenced new document", async () => {
  backend.getMeeting.mockResolvedValue({ ...meeting, notesKey: "results/m1/notes.json" });
  await updateMeetingTitle({ sub: "u1" }, "m1", { title: "새 제목" });
  expect(backend.putFinalDocument).toHaveBeenCalledWith("u1", expect.objectContaining({ title: "새 제목" }), "results/m1/notes.json");
});
