import { beforeEach, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ getMeeting: vi.fn(), readJson: vi.fn(), headObject: vi.fn(), presignDownload: vi.fn() }));
vi.mock("@meeting-notes/backend", async (original) => ({ ...await original<typeof import("@meeting-notes/backend")>(), ...backend }));
import { getMeetingResult } from "../src/routes/meetings.js";

const raw = "transcripts/m1/transcript.json";
const attributed = "results/m1/transcript_attributed.json";
const record = { meetingId: "m1", owner: "u1", status: "COMPLETED", audioKey: "uploads/u1/m1/audio.mp3", transcriptKey: raw, createdAt: "2026-09-08", stages: { speaker_attribution: { status: "COMPLETED" } } };
beforeEach(() => {
  vi.resetAllMocks();
  backend.getMeeting.mockResolvedValue(record);
  backend.headObject.mockResolvedValue({ revision: '"etag-1"' });
  backend.presignDownload.mockImplementation(async (key) => `https://example.test/${key}`);
});

it("serves the corrected transcript with its revision and an original comparison URL", async () => {
  const result = await getMeetingResult({ sub: "u1" }, "m1");
  expect(result.transcriptUrl).toBe(`https://example.test/${attributed}`);
  expect(result.originalTranscriptUrl).toBe(`https://example.test/${raw}`);
  expect(result.transcriptRevision).toBe('"etag-1"');
  expect(backend.headObject).toHaveBeenCalledWith(attributed);
});
it("falls back to the original for older meetings with no attributed object", async () => {
  backend.headObject.mockResolvedValue(null);
  const result = await getMeetingResult({ sub: "u1" }, "m1");
  expect(result.transcriptUrl).toBe(`https://example.test/${raw}`);
  expect(result.originalTranscriptUrl).toBeNull();
});
it("supports legacy records without stage metadata", async () => {
  backend.getMeeting.mockResolvedValue({ ...record, stages: undefined });
  expect((await getMeetingResult({ sub: "u1" }, "m1")).transcriptUrl).toBe(`https://example.test/${raw}`);
  expect(backend.headObject).not.toHaveBeenCalled();
});
it.each(["PENDING", "RUNNING", "FAILED"])("does not serve partial or stale output while attribution is %s", async (status) => {
  backend.getMeeting.mockResolvedValue({ ...record, stages: { speaker_attribution: { status } } });
  expect((await getMeetingResult({ sub: "u1" }, "m1")).transcriptUrl).toBe(`https://example.test/${raw}`);
  expect(backend.headObject).not.toHaveBeenCalled();
});
it("does not read or sign another user's transcript", async () => {
  await expect(getMeetingResult({ sub: "u2" }, "m1")).rejects.toMatchObject({ status: 404 });
  expect(backend.headObject).not.toHaveBeenCalled();
  expect(backend.presignDownload).not.toHaveBeenCalled();
});
it("surfaces storage failures instead of silently returning an inconsistent original", async () => {
  backend.headObject.mockRejectedValue(new Error("AccessDenied"));
  await expect(getMeetingResult({ sub: "u1" }, "m1")).rejects.toThrow("AccessDenied");
});
it("returns no transcript before transcription has produced a source", async () => {
  backend.getMeeting.mockResolvedValue({ ...record, transcriptKey: undefined, status: "UPLOAD_PENDING" });
  expect(await getMeetingResult({ sub: "u1" }, "m1")).toMatchObject({ transcriptUrl: null, originalTranscriptUrl: null, audioUrl: null });
  expect(backend.headObject).not.toHaveBeenCalled();
});
