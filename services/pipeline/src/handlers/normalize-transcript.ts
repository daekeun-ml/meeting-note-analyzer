import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { env, s3 } from "@meeting-notes/backend";
import { s3Keys, sttOutputSchema, type SttOutput, type Transcript } from "@meeting-notes/shared";
import { setStage, updateMeeting } from "../lib/meeting-updates.js";
import { parseS3Uri } from "../lib/s3-uri.js";
import { transcriptToMarkdown } from "../lib/transcript-format.js";

export interface NormalizeInput { meetingId: string; title: string; outputLocation?: string | null; skipped?: boolean; transcriptKey?: string | null }

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
  const transcript = normalize(raw);
  assertSpeech(transcript);
  const transcriptKey = s3Keys.transcriptJson(input.meetingId);
  await Promise.all([
    s3.send(new PutObjectCommand({ Bucket: env.dataBucket, Key: transcriptKey, Body: JSON.stringify(transcript), ContentType: "application/json" })),
    s3.send(new PutObjectCommand({ Bucket: env.dataBucket, Key: s3Keys.transcriptMd(input.meetingId), Body: transcriptToMarkdown(transcript, input.title), ContentType: "text/markdown; charset=utf-8" })),
  ]);
  await setStage(input.meetingId, "stt", "COMPLETED", { s3Key: transcriptKey });
  await updateMeeting(input.meetingId, {
    status: "ANALYZING",
    transcriptKey,
    durationSec: transcript.durationSec,
    detectedLanguage: transcript.language ?? undefined,
    speakerCount: transcript.speakers.length,
  });
  return { transcriptKey, durationSec: transcript.durationSec, detectedLanguage: transcript.language, segmentCount: transcript.segments.length };
};
