import type { MeetingStatus, OutputLanguage, Stage } from "./constants.js";

export type StageStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface StageState {
  status: StageStatus;
  startedAt?: string;
  endedAt?: string;
  s3Key?: string;
  error?: string;
}

/** DynamoDB item: PK=MEETING#{id}, SK=META, GSI1PK=USER#{sub}, GSI1SK=createdAt */
export interface MeetingRecord {
  PK: string;
  SK: "META";
  GSI1PK: string;
  GSI1SK: string;
  meetingId: string;
  owner: string;
  ownerEmail?: string;
  title: string;
  status: MeetingStatus;
  currentStage?: Stage | "stt";
  stages: Partial<Record<Stage, StageState>>;
  audioKey: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  outputLanguage: OutputLanguage;
  languageHint?: string;
  /** S3 multipart upload id while status is UPLOAD_PENDING (aborted on delete). */
  uploadId?: string;
  transcriptKey?: string;
  notesKey?: string;
  /** Set while an execution adds only a brief to this published meeting; the meeting itself stays COMPLETED. */
  briefOnly?: boolean;
  /** Brief job state, separate from `status`: RUNNING while the recap is generated, FAILED until the user retries. */
  briefStatus?: "RUNNING" | "FAILED";
  briefError?: string;
  briefExecutionArn?: string;
  durationSec?: number;
  detectedLanguage?: string;
  speakerCount?: number;
  executionArn?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type MeetingDto = Omit<MeetingRecord, "PK" | "SK" | "GSI1PK" | "GSI1SK">;

export function toMeetingDto(rec: MeetingRecord): MeetingDto {
  const { PK: _pk, SK: _sk, GSI1PK: _g1, GSI1SK: _g2, ...rest } = rec;
  return rest;
}

export const meetingKeys = {
  meeting: (meetingId: string) => ({ PK: `MEETING#${meetingId}`, SK: "META" as const }),
  userGsi: (ownerSub: string) => `USER#${ownerSub}`,
  profile: (ownerSub: string) => ({ PK: `USER#${ownerSub}`, SK: "PROFILE" }),
  push: (ownerSub: string, endpointHash: string) => ({ PK: `USER#${ownerSub}`, SK: `PUSH#${endpointHash}` }),
  pushPrefix: "PUSH#",
  taskToken: (inferenceId: string) => ({ PK: `TASKTOKEN#${inferenceId}`, SK: "TOKEN" }),
} as const;

export interface PushSubscriptionRecord {
  PK: string;
  SK: string;
  owner: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
  createdAt: string;
}

export interface TaskTokenRecord {
  PK: string;
  SK: "TOKEN";
  taskToken: string;
  meetingId: string;
  createdAt: string;
  /** DynamoDB TTL (epoch seconds) */
  ttl: number;
}

/** Request/response DTOs for the HTTP API. */
export interface CreateMeetingRequest {
  title?: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  outputLanguage?: OutputLanguage;
  languageHint?: string;
}

export interface UploadPartTarget {
  partNumber: number;
  url: string;
}

/**
 * S3 multipart upload plan: PUT bytes [(partNumber-1)*partSize, partNumber*partSize) of the file to each part URL,
 * keep the returned ETag, then POST the ETags to `completePath`. Multipart keeps each request small enough for mobile
 * networks and lets the client read the file in slices (iOS home-screen apps cannot stream a picked File directly).
 */
export interface CreateMeetingResponse {
  meeting: MeetingDto;
  upload: {
    method: "PUT";
    uploadId: string;
    partSize: number;
    parts: UploadPartTarget[];
    completePath: string;
    expiresAt: string;
    /** @deprecated single-PUT fallback kept for clients still running the pre-multipart bundle (service worker cache). */
    url: string;
    /** @deprecated see `url`. */
    headers: Record<string, string>;
  };
}

export interface CompleteUploadRequest {
  uploadId: string;
  parts: { partNumber: number; etag: string }[];
}

export interface MeetingResultResponse {
  meeting: MeetingDto;
  notes: unknown | null;
  transcriptUrl: string | null;
  audioUrl: string | null;
  notesMarkdownUrl: string | null;
}

/** PATCH /api/meetings/{id}/speakers: new display names keyed by speaker id (S1, S2, ...). */
export interface UpdateSpeakersRequest {
  labels: Record<string, string>;
}
