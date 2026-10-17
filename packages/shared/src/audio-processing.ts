import { z } from "zod";

export const audioProcessingOptionsSchema = z.object({
  denoise: z.boolean().default(true),
  trim: z.boolean().default(true),
  terminology: z.boolean().default(true),
}).strict();
export type AudioProcessingOptions = z.infer<typeof audioProcessingOptionsSchema>;
export const DEFAULT_AUDIO_PROCESSING: AudioProcessingOptions = { denoise: true, trim: true, terminology: true };

const mediaSchema = z.object({ key: z.string().max(1024), startSec: z.number().finite().nonnegative(), endSec: z.number().finite().positive() })
  .refine((value) => value.endSec > value.startSec, "Invalid processed media interval");
const noiseReportSchema = z.object({
  status: z.enum(["applied", "disabled", "failed", "skipped"]),
  method: z.literal("fft"), reductionDb: z.number().finite().nonnegative().max(12),
  noiseFloorDb: z.number().finite().min(-80).max(-20).optional(),
  algorithm: z.literal("wiener-v1").optional(),
  reason: z.enum(["insufficient_noise_profile", "limited_reduction"]).optional(),
  profileFrames: z.number().int().positive().max(1024).optional(),
  sampleReductionDb: z.number().finite().min(0).max(60).optional(),
});
export const audioProcessingReportSchema = z.object({
  version: z.literal(1),
  kind: z.enum(["meeting", "lecture", "interview"]),
  noise: noiseReportSchema,
  transcriptionInput: z.enum(["original", "denoised"]).optional(),
  // A derivative can be regenerated without changing the STT input or transcript.
  mediaNoise: noiseReportSchema.optional(),
  scope: z.object({
    status: z.enum(["applied", "unchanged", "disabled", "review_required", "unavailable"]),
    startSec: z.number().finite().nonnegative(), endSec: z.number().finite().positive(),
    excludedSegmentIds: z.array(z.string()).default([]), excludedSegmentCount: z.number().int().nonnegative().default(0),
    leadingReason: z.string().max(400), trailingReason: z.string().max(400),
    reviewReasons: z.array(z.string().max(600)), evidence: z.array(z.object({ segmentId: z.string(), quote: z.string().max(600) })).max(2),
  }),
  terms: z.object({ version: z.string().max(80), applied: z.number().int().nonnegative(), review: z.number().int().nonnegative() }),
  media: z.object({ audio: mediaSchema.optional(), video: mediaSchema.optional() }),
  warnings: z.array(z.string().max(600)),
});
export type AudioProcessingReport = z.infer<typeof audioProcessingReportSchema>;
export interface ProcessedMediaLinks {
  processing?: AudioProcessingReport;
  processedAudioUrl?: string | null;
  processedVideoUrl?: string | null;
  sourceAudioDownloadUrl?: string | null;
  sourceVideoDownloadUrl?: string | null;
}

export const processingDeletionKey = (kind: AudioProcessingReport["kind"], id: string) => `stt/deleted/${kind}/${id}.json`;

export function processedMediaPrefix(kind: AudioProcessingReport["kind"], id: string) {
  const root = kind === "lecture" ? "lecture-results" : kind === "interview" ? "interview-results" : "results";
  return `${root}/${id}/processed/`;
}

export function validProcessedMediaKey(kind: AudioProcessingReport["kind"], id: string, key: string, asset: "audio" | "video") {
  const prefix = processedMediaPrefix(kind, id);
  return key.startsWith(prefix) && new RegExp(`^[0-9a-f]{32}/${asset}\\.${asset === "audio" ? "mp3" : "mp4"}$`).test(key.slice(prefix.length));
}

/** Keep the full segment/evidence audit in S3, not in every DynamoDB list response. */
export function processingSummary(report: AudioProcessingReport): AudioProcessingReport {
  return { ...report, scope: { ...report.scope, excludedSegmentCount: report.scope.excludedSegmentIds.length, excludedSegmentIds: [], evidence: [] } };
}
