import { beforeEach, expect, it, vi } from "vitest";
import { audioProcessingReportSchema, type SttOutput } from "@meeting-notes/shared";
const send = vi.hoisted(() => vi.fn());
vi.mock("@meeting-notes/backend", () => ({ env: { dataBucket: "bucket" }, s3: { send } }));
vi.mock("../src/lib/meeting-updates.js", () => ({ setStage: vi.fn(), updateMeeting: vi.fn() }));
import { persistTranscripts, validateProcessing } from "../src/handlers/normalize-transcript.js";

function fixture(): SttOutput {
  const original = [
    { id: "s1", start: 0, end: 10, speaker: "S1", text: "점심 이야기", words: [] },
    { id: "s2", start: 10, end: 30, speaker: "S1", text: "이제 회의를 시작하겠습니다. 에스쓰리를 사용합니다.", words: [{ w: "에스쓰리", s: 20, e: 21 }] },
    { id: "s3", start: 30, end: 100, speaker: "S2", text: "백업을 설정했습니다.", words: [] },
  ];
  return { version: 1, meetingId: "m1", model: "fake", language: "ko", durationSec: 100, mode: "intended", speakers: [], stats: {},
    originalSegments: original, segments: [{ ...original[1]!, text: "이제 회의를 시작하겠습니다. Amazon S3를 사용합니다.", originalText: original[1]!.text, words: [],
      termCorrections: [{ termId: "aws.s3", original: "에스쓰리", replacement: "Amazon S3", method: "dictionary_alias" }] }, original[2]!],
    processing: audioProcessingReportSchema.parse({
      version: 1, kind: "meeting", noise: { status: "applied", method: "fft", reductionDb: 6 },
      scope: { status: "applied", startSec: 10, endSec: 100, excludedSegmentIds: ["s1"], excludedSegmentCount: 1,
        leadingReason: "시작 전 잡담", trailingReason: "", reviewReasons: [], evidence: [{ segmentId: "s2", quote: "이제 회의를 시작하겠습니다." }] },
      terms: { version: "v1", applied: 1, review: 0 }, media: { audio: { key: `results/m1/processed/${"a".repeat(32)}/audio.mp3`, startSec: 10, endSec: 100 } }, warnings: [],
    }),
  };
}
beforeEach(() => {
  send.mockReset();
  send.mockImplementation(async (command) => {
    if (command.constructor.name === "HeadObjectCommand") throw Object.assign(new Error("missing"), { name: "NotFound" });
    return {};
  });
});

it("saves separate raw and processed transcripts and preserves original timing and spelling evidence", async () => {
  const raw = fixture();
  const original = structuredClone(raw);
  const result = await persistTranscripts(raw, "transcripts/m1/transcript.json", "meeting", "m1");
  const objects = Object.fromEntries(send.mock.calls.filter(([command]) => command.input.Body).map(([command]) => [command.input.Key, JSON.parse(command.input.Body)]));
  expect(objects["transcripts/m1/transcript_original.json"].segments).toEqual(raw.originalSegments);
  expect(objects["transcripts/m1/transcript.json"].segments[0]).toMatchObject({ id: "s2", start: 10, originalText: raw.originalSegments![1]!.text });
  expect(objects["transcripts/m1/transcript.json"].originalSegments).toBeUndefined();
  expect(result.processing?.scope.excludedSegmentCount).toBe(1);
  expect(result.processing?.scope.excludedSegmentIds).toEqual([]);
  expect(raw).toEqual(original);
});

it("rejects foreign artifacts, invented evidence, timeline shifts, and interior exclusions before publishing", async () => {
  const badKey = fixture(); badKey.processing!.media.audio!.key = `results/other/processed/${"a".repeat(32)}/audio.mp3`;
  await expect(persistTranscripts(badKey, "transcripts/m1/transcript.json", "meeting", "m1")).rejects.toThrow("outside");
  const badTime = fixture(); badTime.segments[0]!.start = 0;
  expect(() => validateProcessing(badTime, "meeting", "m1")).toThrow("timing");
  const badQuote = fixture(); badQuote.processing!.scope.evidence[0]!.quote = "없는 발언";
  expect(() => validateProcessing(badQuote, "meeting", "m1")).toThrow("evidence");
  const badMediaTime = fixture(); badMediaTime.processing!.media.audio!.startSec = 0;
  expect(() => validateProcessing(badMediaTime, "meeting", "m1")).toThrow("scope");
  const badCount = fixture(); badCount.processing!.scope.excludedSegmentCount = 0;
  expect(() => validateProcessing(badCount, "meeting", "m1")).toThrow("audit");
  const interior = fixture(); interior.segments = [interior.originalSegments![0]!, interior.originalSegments![2]!]; interior.processing!.scope.startSec = 0;
  expect(() => validateProcessing(interior, "meeting", "m1")).toThrow("interior");
  expect(send).not.toHaveBeenCalled();
});

it("does not publish a transcript produced with a different model selection", async () => {
  const raw = fixture();
  raw.speechModels = { stt: "crisperwhisper", diarization: "community1" };
  await expect(persistTranscripts(raw, "transcripts/m1/transcript.json", "meeting", "m1",
    { stt: "qwen3-asr", diarization: "nemotron3" })).rejects.toThrow("different speech model");
  expect(send).not.toHaveBeenCalled();
});

it("removes late transcript writes when deletion begins while the files are being saved", async () => {
  let heads = 0;
  send.mockImplementation(async (command) => {
    if (command.constructor.name === "HeadObjectCommand" && heads++ === 0) throw Object.assign(new Error("missing"), { name: "NotFound" });
    return {};
  });
  await expect(persistTranscripts(fixture(), "transcripts/m1/transcript.json", "meeting", "m1")).rejects.toThrow("deleted");
  expect(send.mock.calls.filter(([command]) => command.constructor.name === "DeleteObjectCommand").map(([command]) => command.input.Key))
    .toEqual(["transcripts/m1/transcript.json", "transcripts/m1/transcript_original.json"]);
});
