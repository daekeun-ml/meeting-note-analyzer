import { SFNClient } from "@aws-sdk/client-sfn";
import { beforeEach, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ getMeeting: vi.fn(), readJson: vi.fn(), claimRetry: vi.fn(), releaseRetry: vi.fn(), countActiveMeetings: vi.fn(), markBriefRun: vi.fn() }));
vi.mock("@meeting-notes/backend", async (original) => ({ ...await original<typeof import("@meeting-notes/backend")>(), ...backend }));
vi.mock("../src/lib/env.js", () => ({ apiEnv: { stateMachineArn: "arn:aws:states:us-east-1:123456789012:stateMachine:meetings" } }));
import { createMeetingBrief } from "../src/routes/meetings.js";

const send = vi.spyOn(SFNClient.prototype, "send");
const meeting = { meetingId: "m1", owner: "u1", status: "COMPLETED", notesKey: "results/m1/document.json", transcriptKey: "transcripts/m1/transcript.json" };
beforeEach(() => {
  vi.resetAllMocks();
  backend.getMeeting.mockResolvedValue({ ...meeting });
  backend.readJson.mockResolvedValue({ meetingId: "m1" });
  backend.claimRetry.mockResolvedValue(true);
  backend.countActiveMeetings.mockResolvedValue(0);
  backend.releaseRetry.mockResolvedValue(undefined);
  backend.markBriefRun.mockResolvedValue(undefined);
  send.mockResolvedValue({ executionArn: "execution-1" } as never);
});

it("claims a completed meeting and starts only the brief path", async () => {
  expect(await createMeetingBrief({ sub: "u1" }, "m1")).toEqual({ executionArn: "execution-1" });
  expect(backend.claimRetry).toHaveBeenCalledWith("m1", expect.any(String), "COMPLETED");
  const command = send.mock.calls[0]![0] as unknown as { input: { input: string } };
  expect(JSON.parse(command.input.input)).toEqual({ retry: { meetingId: "m1", briefOnly: true } });
  expect(backend.markBriefRun).toHaveBeenCalledWith("m1", "execution-1");
});
it("refuses a second request while a brief is running and allows one after a failure", async () => {
  backend.getMeeting.mockResolvedValueOnce({ ...meeting, briefStatus: "RUNNING" });
  await expect(createMeetingBrief({ sub: "u1" }, "m1")).rejects.toMatchObject({ code: "brief_in_progress" });
  expect(send).not.toHaveBeenCalled();
  backend.getMeeting.mockResolvedValueOnce({ ...meeting, briefOnly: true, briefStatus: "FAILED", briefError: "rejected" });
  expect(await createMeetingBrief({ sub: "u1" }, "m1")).toEqual({ executionArn: "execution-1" });
});
it("rejects other users without reading their document or invoking a model", async () => {
  await expect(createMeetingBrief({ sub: "u2" }, "m1")).rejects.toMatchObject({ status: 404 });
  expect(backend.readJson).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it("rejects duplicate briefs and concurrent requests", async () => {
  backend.readJson.mockResolvedValueOnce({ meetingId: "m1", brief: {} });
  await expect(createMeetingBrief({ sub: "u1" }, "m1")).rejects.toMatchObject({ code: "brief_exists" });
  backend.claimRetry.mockResolvedValueOnce(false);
  await expect(createMeetingBrief({ sub: "u1" }, "m1")).rejects.toMatchObject({ code: "retry_in_progress" });
  expect(send).not.toHaveBeenCalled();
});
it("rejects unfinished meetings and missing documents", async () => {
  backend.getMeeting.mockResolvedValueOnce({ ...meeting, status: "ANALYZING" });
  await expect(createMeetingBrief({ sub: "u1" }, "m1")).rejects.toMatchObject({ code: "not_completed" });
  backend.readJson.mockResolvedValueOnce(null);
  await expect(createMeetingBrief({ sub: "u1" }, "m1")).rejects.toMatchObject({ code: "not_found" });
});
it("releases only this request's token if execution cannot start", async () => {
  send.mockRejectedValueOnce(new Error("unavailable") as never);
  await expect(createMeetingBrief({ sub: "u1" }, "m1")).rejects.toThrow("unavailable");
  expect(backend.releaseRetry).toHaveBeenCalledWith("m1", backend.claimRetry.mock.calls[0]![1]);
});
it("honors the existing active-meeting limit", async () => {
  backend.countActiveMeetings.mockResolvedValueOnce(3);
  await expect(createMeetingBrief({ sub: "u1" }, "m1")).rejects.toMatchObject({ status: 429 });
  expect(backend.claimRetry).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
