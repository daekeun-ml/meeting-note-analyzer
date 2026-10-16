import { useState } from "react";
import type { ProcessedMediaLinks } from "@meeting-notes/shared";
import { Button, Card, InlineError } from "./ui";
import { hms } from "./AudioPlayer";

type Download = "processedAudioUrl" | "processedVideoUrl" | "sourceAudioDownloadUrl" | "sourceVideoDownloadUrl";
const labels: [Download, string][] = [
  ["processedAudioUrl", "전처리 MP3 다운로드"], ["processedVideoUrl", "전처리 MP4 다운로드"],
  ["sourceAudioDownloadUrl", "원본 MP3 다운로드"], ["sourceVideoDownloadUrl", "원본 MP4 다운로드"],
];

export function ProcessedMedia({ result, refresh }: { result: ProcessedMediaLinks; refresh: () => Promise<ProcessedMediaLinks | undefined> }) {
  const [busy, setBusy] = useState<Download | null>(null), [error, setError] = useState("");
  const processing = result.processing;
  if (!processing) return null;
  async function download(key: Download) {
    setBusy(key); setError("");
    try {
      // Never load large media into a browser Blob. Refresh signatures, then let S3 stream the attachment.
      const latest = await refresh();
      const url = latest?.[key];
      if (!url) throw new Error("다운로드 파일을 확인하지 못했습니다. 다시 시도해 주세요.");
      const anchor = document.createElement("a");
      anchor.href = url; anchor.rel = "noreferrer"; anchor.download = "";
      document.body.appendChild(anchor);
      try { anchor.click(); } finally { anchor.remove(); }
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(null); }
  }
  const { noise, scope, terms } = processing;
  return <Card className="mt-4 p-4">
    <h2 className="font-semibold">전처리 파일</h2>
    <p className="mt-2 text-xs leading-relaxed text-ink-2">
      {noise.status === "applied" ? "잡음 감소 적용" : noise.status === "failed" ? "잡음 감소 미적용" : "잡음 감소 끔"}, {scope.status === "applied" ? `앞뒤 발언 ${scope.excludedSegmentCount}개 제외` : "전체 발언 유지"}, 용어 {terms.applied}건 교정
    </p>
    <div className="mt-3 flex flex-wrap gap-2">{labels.filter(([key]) => !!result[key]).map(([key, label]) =>
      <Button key={key} size="sm" variant={key.startsWith("processed") ? "primary" : "secondary"} disabled={!!busy} loading={busy === key} onClick={() => void download(key)}>{label}</Button>)}</div>
    {processing.warnings.filter((warning) => warning.startsWith("전처리 ")).map((warning, i) => <p key={i} className="mt-2 text-xs text-warning">{warning}</p>)}
    {error && <InlineError>{error}</InlineError>}
    <details className="mt-3 text-xs text-ink-3">
      <summary className="cursor-pointer">전처리 범위와 교정 정보</summary>
      <p className="mt-2">분석 구간: 원본 {hms(scope.startSec)}–{hms(scope.endSec)}. 전사와 노트의 시간은 원본 녹음 기준입니다.</p>
      {processing.media.audio && <p className="mt-2">MP3 파일의 0초는 원본 {hms(processing.media.audio.startSec)}입니다.</p>}
      {processing.media.video && <p className="mt-2">MP4 파일의 0초는 원본 {hms(processing.media.video.startSec)}입니다.</p>}
      {[scope.leadingReason, scope.trailingReason, ...scope.reviewReasons, ...processing.warnings].filter(Boolean).map((text, i) => <p key={i} className="mt-2">{text}</p>)}
      <p className="mt-2">사전 {terms.version}. 확인 후보 {terms.review}건은 자동 교정하지 않았습니다. 전사 탭에서 원문과 비교할 수 있습니다.</p>
    </details>
  </Card>;
}
