import { z } from "zod";

/** Namespace shared by the SageMaker inference ID and SNS message-body filters. */
export const LECTURE_INFERENCE_PREFIX = "lecture-";
export function isLectureInference(inferenceId: string): boolean { return inferenceId.startsWith(LECTURE_INFERENCE_PREFIX); }

/** Output written by the SageMaker STT container (CrisperWhisper + pyannote). */
export const sttWordSchema = z.object({ w: z.string(), s: z.number(), e: z.number(), p: z.number().nullable().optional() });

export const sttSegmentSchema = z.object({
  id: z.string(),
  start: z.number(),
  end: z.number(),
  speaker: z.string(),
  text: z.string(),
  words: z.array(sttWordSchema).default([]),
});

export const sttSpeakerSchema = z.object({ id: z.string(), talkTimeSec: z.number() });

export const sttOutputSchema = z.object({
  version: z.literal(1),
  meetingId: z.string(),
  language: z.string().nullable(),
  languageProbability: z.number().nullable().optional(),
  durationSec: z.number(),
  mode: z.enum(["intended", "verbatim"]),
  model: z.string(),
  speakers: z.array(sttSpeakerSchema),
  segments: z.array(sttSegmentSchema),
  stats: z.record(z.unknown()).default({}),
});
export type SttOutput = z.infer<typeof sttOutputSchema>;
export type SttSegment = z.infer<typeof sttSegmentSchema>;

/** Normalized transcript stored at transcripts/{id}/transcript.json (same shape, guaranteed sorted + ids). */
export const transcriptSchema = sttOutputSchema.extend({
  normalizedAt: z.string(),
});
export type Transcript = z.infer<typeof transcriptSchema>;
