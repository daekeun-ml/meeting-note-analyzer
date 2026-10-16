import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { env, s3 } from "@meeting-notes/backend";
import { processingDeletionKey, processingSummary, s3Keys, sttOutputSchema, validProcessedMediaKey, type AudioProcessingReport, type SttOutput, type Transcript } from "@meeting-notes/shared";
import { LEGACY_SPEECH_MODELS, sameSpeechModels, type SpeechModels } from "@meeting-notes/shared";
import { setStage, updateMeeting } from "../lib/meeting-updates.js";
import { parseS3Uri } from "../lib/s3-uri.js";
import { transcriptToMarkdown } from "../lib/transcript-format.js";

export interface NormalizeInput { meetingId: string; title: string; outputLocation?: string | null; skipped?: boolean; transcriptKey?: string | null; speechModels?: SpeechModels }

/** Sorts segments, guarantees stable ids, and recomputes speaker talk time. Pure; exported for tests. */
export function normalize(raw: SttOutput, now = new Date()): Transcript {
  const segments = [...raw.segments]
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((seg, i) => ({ ...seg, id: seg.id || `seg-${String(i + 1).padStart(4, "0")}`, text: seg.text.trim() }))
    .filter((seg) => seg.text.length > 0);
  const talk = new Map<string, number>();
  for (const seg of segments) talk.set(seg.speaker, (talk.get(seg.speaker) ?? 0) + Math.max(0, seg.end - seg.start));
  const speakers = [...talk.entries()]
    .map(([id, talkTimeSec]) => ({ id, talkTimeSec: Math.round(talkTimeSec * 10) / 10 }))
    .sort((a, b) => b.talkTimeSec - a.talkTimeSec);
  return { ...raw, segments, speakers, normalizedAt: now.toISOString() };
}

export class NoSpeechError extends Error {
  override readonly name = "NoSpeechError";
}

/** A recording with no recognized speech must fail here, not run ten analysis stages on an empty transcript. */
export function assertSpeech(transcript: Transcript): void {
  if (transcript.segments.length) return;
  throw new NoSpeechError(`녹음에서 발화를 찾지 못했습니다 (길이 ${Math.round(transcript.durationSec)}초). 녹음 상태를 확인한 뒤 다시 올려 주세요.`);
}

/** Verify preprocessing cannot introduce speech, renumber evidence, or remove an interior passage. */
export function validateProcessing(raw: SttOutput, kind: AudioProcessingReport["kind"], id: string): void {
  if (raw.meetingId !== id) throw new Error("Transcript belongs to another recording");
  if (!raw.processing) {
    if (raw.originalSegments) throw new Error("Original transcript has no processing audit");
    return;
  }
  const report = raw.processing, scope = report.scope;
  if (report.kind !== kind || !raw.originalSegments || scope.startSec >= scope.endSec || scope.endSec > raw.durationSec + 0.05) throw new Error("Invalid transcript processing metadata");
  const original = raw.originalSegments;
  const byId = new Map(original.map((segment, index) => [segment.id, { segment, index }]));
  if (byId.size !== original.length || (original.length && !raw.segments.length)) throw new Error("Invalid retained speech");
  const indices: number[] = [];
  for (const segment of raw.segments) {
    const source = byId.get(segment.id);
    if (!source || segment.start !== source.segment.start || segment.end !== source.segment.end || segment.speaker !== source.segment.speaker) throw new Error("Processing changed transcript evidence identity or timing");
    if (segment.text !== source.segment.text && (segment.originalText !== source.segment.text || !segment.termCorrections?.length)) throw new Error("Transcript correction has no original evidence");
    if (segment.start < scope.startSec - 0.05 || segment.end > scope.endSec + 0.05) throw new Error("Speech lies outside the analysis scope");
    indices.push(source.index);
  }
  if (indices.some((index, i) => i > 0 && index !== indices[i - 1]! + 1)) throw new Error("Processing removed an interior passage");
  const retained = new Set(raw.segments.map((s) => s.id));
  const excluded = original.filter((s) => !retained.has(s.id)).map((s) => s.id);
  if (excluded.length !== scope.excludedSegmentIds.length || excluded.length !== scope.excludedSegmentCount || excluded.some((id) => !scope.excludedSegmentIds.includes(id))) throw new Error("Excluded speech audit does not match the transcript");
  if ((excluded.length > 0) !== (scope.status === "applied")) throw new Error("Scope status does not match excluded speech");
  if (excluded.length && !scope.evidence.length) throw new Error("Scope has no boundary evidence");
  if (scope.evidence.some((evidence) => !retained.has(evidence.segmentId) || !byId.get(evidence.segmentId)?.segment.text.includes(evidence.quote))) throw new Error("Scope boundary evidence does not match the original");
  for (const asset of ["audio", "video"] as const) {
    const media = report.media[asset];
    if (media && (!validProcessedMediaKey(kind, id, media.key, asset) || Math.abs(media.endSec - scope.endSec) > 0.05 ||
      (asset === "audio" ? Math.abs(media.startSec - scope.startSec) > 0.05 : media.startSec > scope.startSec + 0.05))) throw new Error("Processed media is outside this recording's scope");
  }
}

/** Keep raw STT separately; analysis keeps original segment IDs and recording timestamps. */
export async function persistTranscripts(raw: SttOutput, key: string, kind: AudioProcessingReport["kind"], id: string, expectedModels?: SpeechModels) {
  validateProcessing(raw, kind, id);
  if (raw.model !== "silent-video" && expectedModels && !sameSpeechModels(expectedModels, raw.speechModels ?? LEGACY_SPEECH_MODELS)) {
    throw new Error("Transcript was produced by a different speech model selection");
  }
  async function checkActive() {
    if (!raw.processing) return;
    try { await s3.send(new HeadObjectCommand({ Bucket: env.dataBucket, Key: processingDeletionKey(kind, id) })); }
    catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "NotFound" || name === "NoSuchKey" || (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return;
      throw error;
    }
    throw new Error("Recording was deleted");
  }
  await checkActive();
  const transcript = normalize({ ...raw, originalSegments: undefined });
  const originalTranscriptKey = raw.originalSegments ? key.replace(/\.json$/, "_original.json") : undefined;
  const writes = [s3.send(new PutObjectCommand({ Bucket: env.dataBucket, Key: key, Body: JSON.stringify(transcript), ContentType: "application/json" }))];
  if (originalTranscriptKey && raw.originalSegments) {
    const original = normalize({ ...raw, segments: raw.originalSegments, originalSegments: undefined, processing: undefined });
    writes.push(s3.send(new PutObjectCommand({ Bucket: env.dataBucket, Key: originalTranscriptKey, Body: JSON.stringify(original), ContentType: "application/json" })));
  }
  const outcomes = await Promise.allSettled(writes);
  try { await checkActive(); }
  catch (error) {
    await Promise.all([key, ...(originalTranscriptKey ? [originalTranscriptKey] : [])].map((Key) => s3.send(new DeleteObjectCommand({ Bucket: env.dataBucket, Key }))));
    throw error;
  }
  const failed = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
  if (failed) throw failed.reason;
  return { transcript, originalTranscriptKey, processing: raw.processing ? processingSummary(raw.processing) : undefined };
}

export const handler = async (input: NormalizeInput) => {
  if (input.skipped && input.transcriptKey) {
    await updateMeeting(input.meetingId, { status: "ANALYZING" });
    return { transcriptKey: input.transcriptKey, skipped: true };
  }
  if (!input.outputLocation) throw new Error("STT output location missing");
  const { bucket, key } = parseS3Uri(input.outputLocation);
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const text = (await obj.Body?.transformToString("utf8")) ?? "";
  const raw = sttOutputSchema.parse(JSON.parse(text));
  assertSpeech(normalize(raw));
  const transcriptKey = s3Keys.transcriptJson(input.meetingId);
  const { transcript, originalTranscriptKey, processing } = await persistTranscripts(raw, transcriptKey, "meeting", input.meetingId, input.speechModels);
  await s3.send(new PutObjectCommand({ Bucket: env.dataBucket, Key: s3Keys.transcriptMd(input.meetingId), Body: transcriptToMarkdown(transcript, input.title), ContentType: "text/markdown; charset=utf-8" }));
  await setStage(input.meetingId, "stt", "COMPLETED", { s3Key: transcriptKey });
  await updateMeeting(input.meetingId, {
    status: "ANALYZING",
    transcriptKey,
    originalTranscriptKey, processing,
    transcriptSpeechModels: raw.speechModels ?? LEGACY_SPEECH_MODELS,
    durationSec: transcript.durationSec,
    detectedLanguage: transcript.language ?? undefined,
    speakerCount: transcript.speakers.length,
  });
  return { transcriptKey, durationSec: transcript.durationSec, detectedLanguage: transcript.language, segmentCount: transcript.segments.length };
};
