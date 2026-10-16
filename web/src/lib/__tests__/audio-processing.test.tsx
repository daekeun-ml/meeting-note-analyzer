// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { audioProcessingReportSchema } from "@meeting-notes/shared";
import { AudioProcessingSettings } from "../../components/AudioProcessingSettings";
import { ProcessedMedia } from "../../components/ProcessedMedia";
import { transcriptExport } from "../transcript-export";

let element: HTMLDivElement, root: Root;
const report = () => audioProcessingReportSchema.parse({
  version: 1, kind: "lecture", noise: { status: "applied", method: "fft", reductionDb: 6 },
  scope: { status: "applied", startSec: 12, endSec: 100, excludedSegmentIds: [], excludedSegmentCount: 2,
    leadingReason: "시작 전 잡담", trailingReason: "", reviewReasons: [], evidence: [] },
  terms: { version: "v1", applied: 3, review: 1 }, media: {
    audio: { key: "a.mp3", startSec: 12, endSec: 100 }, video: { key: "v.mp4", startSec: 10, endSec: 100 },
  }, warnings: [],
});
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.restoreAllMocks(); });

it("defaults to conservative processing and allows each option to be disabled before uploading", async () => {
  const change = vi.fn();
  await act(async () => root.render(<AudioProcessingSettings value={{ denoise: true, trim: true, terminology: true }} onChange={change} />));
  const inputs = [...element.querySelectorAll<HTMLInputElement>("input")];
  expect(inputs).toHaveLength(3); expect(inputs.every((input) => input.checked)).toBe(true);
  await act(async () => inputs[1]!.click());
  expect(change).toHaveBeenCalledWith({ denoise: true, trim: false, terminology: true });
});

it("refreshes signed downloads and navigates to the attachment without buffering media in a Blob", async () => {
  const urls = { processing: report(), processedAudioUrl: "https://example.org/old.mp3", processedVideoUrl: "https://example.org/old.mp4", sourceVideoDownloadUrl: "https://example.org/original.mp4" };
  const refresh = vi.fn(async () => ({ ...urls, processedAudioUrl: "https://example.org/fresh.mp3" }));
  const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.href); });
  await act(async () => root.render(<ProcessedMedia result={urls} refresh={refresh} />));
  expect(element.textContent).toContain("앞뒤 발언 2개 제외");
  expect(element.textContent).toContain("용어 3건 교정");
  expect(element.textContent).toContain("원본 MP4 다운로드");
  await act(async () => [...element.querySelectorAll("button")].find((button) => button.textContent === "전처리 MP3 다운로드")!.click());
  expect(refresh).toHaveBeenCalledOnce();
  expect(downloads).toEqual(["https://example.org/fresh.mp3"]);
});

it("exports processed spellings with original wording and original recording timestamps", () => {
  const result = transcriptExport({ version: 1, meetingId: "m", language: "ko", durationSec: 100, mode: "intended", model: "test",
    normalizedAt: "now", speakers: [{ id: "S1", talkTimeSec: 10 }], stats: {}, processing: report(),
    segments: [{ id: "s2", start: 12, end: 20, speaker: "S1", text: "Amazon S3를 사용합니다.", originalText: "에스쓰리를 사용합니다.", words: [] }],
  }, { title: "수업", variant: "processed", format: "md" });
  expect(result.filename).toBe("수업_전처리전사.md");
  expect(result.content).toContain("00:00:12");
  expect(result.content).toContain("교정 전: 에스쓰리를 사용합니다");
  expect(result.content).toContain("모든 시간은 원본 녹음 기준");
});

it("reports a skipped or ineffective legacy filter without claiming noise was removed", async () => {
  const processing = report();
  processing.noise = { status: "skipped", method: "fft", algorithm: "wiener-v1", reductionDb: 0, reason: "insufficient_noise_profile" };
  await act(async () => root.render(<ProcessedMedia result={{ processing }} refresh={async () => undefined} />));
  expect(element.textContent).toContain("잡음 추정 불충분");
  expect(element.textContent).not.toContain("잡음 감소 적용");
  processing.noise = { status: "applied", method: "fft", reductionDb: 6, noiseFloorDb: -80 };
  await act(async () => root.render(<ProcessedMedia result={{ processing }} refresh={async () => undefined} />));
  expect(element.textContent).toContain("제거 효과 제한");
});

it("separates regenerated download audio from the original transcription preprocessing", async () => {
  const processing = report();
  processing.noise = { status: "applied", method: "fft", reductionDb: 6, noiseFloorDb: -80 };
  processing.mediaNoise = { status: "applied", method: "fft", algorithm: "wiener-v1", reductionDb: 10, sampleReductionDb: 4.5 };
  const validated = audioProcessingReportSchema.parse(processing);
  expect(validated.noise.noiseFloorDb).toBe(-80);
  await act(async () => root.render(<ProcessedMedia result={{ processing: validated }} refresh={async () => undefined} />));
  expect(element.textContent).toContain("잡음 감소 적용");
  expect(element.textContent).toContain("약 4.5 dB");
  expect(element.textContent).toContain("기존 전사와 분석 결과는 유지");
});

it("explains that new transcription uses the original recording", async () => {
  const processing = audioProcessingReportSchema.parse({ ...report(), transcriptionInput: "original" });
  await act(async () => root.render(<ProcessedMedia result={{ processing }} refresh={async () => undefined} />));
  expect(element.textContent).toContain("전사와 화자 분리는 원본 음성을 기준으로 처리");
});
