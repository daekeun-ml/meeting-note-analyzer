import { beforeEach, expect, it, vi } from "vitest";
import { STAGES, s3Keys, transcriptSchema, type StageOutputs, type Transcript } from "@meeting-notes/shared";

const backend = vi.hoisted(() => ({ getMeeting: vi.fn(), readJson: vi.fn(), putFinalDocument: vi.fn(), notifyUser: vi.fn(), s3: { send: vi.fn() }, env: { dataBucket: "test-bucket" } }));
const updateMeeting = vi.hoisted(() => vi.fn());
vi.mock("@meeting-notes/backend", async (original) => ({ ...await original<typeof import("@meeting-notes/backend")>(), withDocumentLock: async (_id: string, operation: () => Promise<unknown>) => operation(), ...backend }));
vi.mock("../src/lib/meeting-updates.js", () => ({ updateMeeting }));
vi.mock("../src/lib/env.js", () => ({ pipelineEnv: { memoryId: "", webOrigin: "https://example.test" } }));
import { handler } from "../src/handlers/finalize.js";

const original: Transcript = { version: 1, meetingId: "m1", normalizedAt: "2026-09-08", durationSec: 5, language: "ko", mode: "intended", model: "test", stats: {}, speakers: [{ id: "S1", talkTimeSec: 5 }], segments: [{ id: "seg-1", speaker: "S1", start: 0, end: 5, text: "원래 발언", words: [] }] };
let attributed: Transcript | null;
const input = { meetingId: "m1", ownerSub: "u1", title: "회의", outputLanguage: "ko", transcriptKey: s3Keys.transcriptJson("m1") };
const outputs = {
  speaker_attribution: { speakers: [{ id: "S1", label: "S1", confidence: 0, evidence: [], reviewRequired: true }] },
  topic_segmentation: { topics: [], meetingType: "회의", purpose: "공유" },
  summary: { headline: "요약", overview: "개요" }, agenda: { items: [] }, notes: { markdown: "기록", sections: [] },
  follow_ups: { items: [] }, suggestions: { items: [] }, mindmap: {}, meeting_brief: {},
  transcript_analysis: { languages: [], primaryLanguage: "ko", quality: {}, glossary: [] },
} as unknown as StageOutputs;
beforeEach(() => {
  vi.resetAllMocks();
  attributed = { ...original, attributed: true, speakerAttribution: { version: 2, corrections: [{ id: "c1", kind: "label", from: ["S1"], to: "S1", proposedLabel: "후보", status: "review_required", reason: "추정", issues: ["context_only"], evidence: [], segmentIds: ["seg-1"] }] },
    segments: [{ ...original.segments[0]!, originalSpeaker: "S1", speakerLabel: "S1", speakerReviewRequired: true, speakerCorrectionIds: ["c1"] }] };
  backend.getMeeting.mockResolvedValue({ owner: "u1" });
  backend.putFinalDocument.mockResolvedValue({ notesKey: s3Keys.notesJson("m1") });
  backend.notifyUser.mockResolvedValue({ sent: 1 });
  backend.s3.send.mockResolvedValue({});
  backend.readJson.mockImplementation(async (key) => {
    if (key === input.transcriptKey) return original;
    if (key === s3Keys.attributedTranscript("m1")) return attributed;
    const stage = STAGES.find((s) => s3Keys.stageResult("m1", s) === key);
    return stage ? outputs[stage] : null;
  });
});
it("preserves attribution metadata through the shared schema and publishes the KB transcript before ingestion", async () => {
  expect(transcriptSchema.parse(attributed).segments[0]).toMatchObject({ speakerReviewRequired: true, speakerCorrectionIds: ["c1"] });
  await handler(input);
  expect(backend.s3.send).toHaveBeenCalledTimes(1);
  const command = backend.s3.send.mock.calls[0]![0];
  expect(command.input.Key).toBe(s3Keys.transcriptMd("m1"));
  expect(command.input.Body).toContain("S1 [speaker review required] (seg-1): 원래 발언");
  expect(backend.s3.send.mock.invocationCallOrder[0]).toBeLessThan(backend.putFinalDocument.mock.invocationCallOrder[0]!);
  expect(updateMeeting.mock.calls[0]![1]).toMatchObject({ speakerCount: 1, status: "COMPLETED" });
  expect(original.segments[0]).not.toHaveProperty("speakerReviewRequired");
});
it("keeps older executions compatible when no reviewed transcript exists", async () => {
  attributed = null;
  await handler(input);
  expect(backend.s3.send).not.toHaveBeenCalled();
  expect(backend.putFinalDocument).toHaveBeenCalledOnce();
});
it("rejects cross-meeting transcript data before publishing a final document", async () => {
  attributed!.meetingId = "different";
  await expect(handler(input)).rejects.toThrow("meeting mismatch");
  expect(backend.s3.send).not.toHaveBeenCalled();
  expect(backend.putFinalDocument).not.toHaveBeenCalled();
});
it("does not mark completion if publishing the corrected KB transcript fails", async () => {
  backend.s3.send.mockRejectedValue(new Error("unavailable"));
  await expect(handler(input)).rejects.toThrow("unavailable");
  expect(updateMeeting).not.toHaveBeenCalled();
});
it("publishes the document and KB transcript under the title the record carries at completion", async () => {
  backend.getMeeting.mockResolvedValue({ owner: "u1", title: "바뀐 제목" }); // renamed while the pipeline was running
  await handler(input);
  expect(backend.putFinalDocument.mock.calls[0]![1]).toMatchObject({ title: "바뀐 제목" });
  expect(backend.s3.send.mock.calls[0]![0].input.Body).toContain("# 바뀐 제목");
});
