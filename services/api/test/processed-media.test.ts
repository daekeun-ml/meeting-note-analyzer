import { expect, it, vi } from "vitest";
import { audioProcessingReportSchema } from "@meeting-notes/shared";
const sign = vi.hoisted(() => vi.fn(async (key: string) => `https://example.org/${key}`));
vi.mock("@meeting-notes/backend", () => ({ presignDownload: sign }));
import { processedMediaLinks } from "../src/lib/processed-media.js";

const report = () => audioProcessingReportSchema.parse({
  version: 1, kind: "lecture", noise: { status: "applied", method: "fft", reductionDb: 6 },
  scope: { status: "applied", startSec: 12, endSec: 200, excludedSegmentIds: [], leadingReason: "잡담", trailingReason: "", reviewReasons: [], evidence: [] },
  terms: { version: "v1", applied: 2, review: 1 },
  media: { audio: { key: `lecture-results/l1/processed/${"a".repeat(32)}/audio.mp3`, startSec: 12, endSec: 200 },
    video: { key: `lecture-results/l1/processed/${"a".repeat(32)}/video.mp4`, startSec: 10, endSec: 200 } }, warnings: [],
});

it("signs downloads with attachment filenames and each file's original-time offset", async () => {
  sign.mockClear();
  const value = report();
  const links = await processedMediaLinks("lecture", "l1", "수업", value, { video: "lecture-uploads/u/l1/video.mp4" });
  expect(links.processedAudioUrl).toContain("/audio.mp3");
  expect(links.processedVideoUrl).toContain("/video.mp4");
  expect(sign).toHaveBeenCalledWith(value.media.audio!.key, 3600, "수업_전처리_원본12초부터.mp3");
  expect(sign).toHaveBeenCalledWith(value.media.video!.key, 3600, "수업_전처리_원본10초부터.mp4");
});

it("never signs another recording's processed file", async () => {
  sign.mockClear();
  const value = report(); value.media.audio!.key = `lecture-results/foreign/processed/${"a".repeat(32)}/audio.mp3`;
  await expect(processedMediaLinks("lecture", "l1", "수업", value)).rejects.toThrow("outside");
  expect(sign).not.toHaveBeenCalled();
  expect(await processedMediaLinks("lecture", "l1", "수업")).toEqual({});
});
