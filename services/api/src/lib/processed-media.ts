import { PutObjectCommand } from "@aws-sdk/client-s3";
import { env, presignDownload, s3 } from "@meeting-notes/backend";
import { processingDeletionKey, validProcessedMediaKey, type AudioProcessingReport, type ProcessedMediaLinks } from "@meeting-notes/shared";

/** Fence in-flight preprocessing before removing the parent's artifacts. */
export async function markProcessingDeleted(kind: AudioProcessingReport["kind"], id: string) {
  await s3.send(new PutObjectCommand({ Bucket: env.dataBucket, Key: processingDeletionKey(kind, id), Body: "{}", ContentType: "application/json" }));
}

/** Call only after the parent recording's ownership check. Never sign a foreign artifact key. */
export async function processedMediaLinks(kind: AudioProcessingReport["kind"], id: string, title: string,
  report?: AudioProcessingReport, sources: { audio?: string; video?: string } = {}): Promise<ProcessedMediaLinks> {
  if (!report) return {};
  if (report.kind !== kind) throw new Error("Processed media kind does not match the recording");
  const sign = (asset: "audio" | "video") => {
    const media = report.media[asset];
    if (!media) return Promise.resolve(null);
    if (!validProcessedMediaKey(kind, id, media.key, asset)) throw new Error("Processed media is outside the owned recording");
    const offset = Math.floor(media.startSec);
    return presignDownload(media.key, 3600, `${title}_전처리_원본${offset}초부터.${asset === "audio" ? "mp3" : "mp4"}`);
  };
  const [processedAudioUrl, processedVideoUrl, sourceAudioDownloadUrl, sourceVideoDownloadUrl] = await Promise.all([
    sign("audio"), sign("video"),
    sources.audio ? presignDownload(sources.audio, 3600, `${title}_원본.mp3`) : null,
    sources.video ? presignDownload(sources.video, 3600, `${title}_원본.mp4`) : null,
  ]);
  return { processing: report, processedAudioUrl, processedVideoUrl, sourceAudioDownloadUrl, sourceVideoDownloadUrl };
}
