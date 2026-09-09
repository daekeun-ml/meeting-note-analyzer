import { randomUUID, createHash } from "node:crypto";
import { SFNClient, StartExecutionCommand, StopExecutionCommand } from "@aws-sdk/client-sfn";
import { z } from "zod";
import {
  ACTIVE_STATUSES,
  CONSTRAINTS,
  OUTPUT_LANGUAGES,
  s3Keys,
  meetingKeys,
  toMeetingDto,
  type CompleteUploadRequest,
  type CreateMeetingResponse,
  type MeetingDto,
  type MeetingRecord,
  type MeetingResultResponse,
  type NotesDocument,
} from "@meeting-notes/shared";
import { claimRetry, countActiveMeetings, deleteMeeting, DocumentBusyError, getMeeting, listMeetingsByOwner, markBriefRun, putMeeting, releaseRetry, setMeetingTitle, withDocumentLock } from "@meeting-notes/backend";
import { HttpError, type Caller } from "../lib/http.js";
import { abortMultipartUpload, applySpeakerLabels, completeMultipartUpload, createMultipartUpload, deleteMeetingMemory, deletePrefix, headObject, presignDownload, presignUpload, putFinalDocument, readJson } from "@meeting-notes/backend";
import { apiEnv } from "../lib/env.js";

const sfn = new SFNClient({});

export const createMeetingSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  fileName: z.string().trim().min(1).max(255),
  fileSize: z.number().int().positive().max(CONSTRAINTS.maxUploadBytes, "파일이 너무 큽니다 (최대 500MB)"),
  contentType: z.string().refine((ct) => CONSTRAINTS.allowedContentTypes.includes(ct), "mp3 파일만 업로드할 수 있습니다"),
  outputLanguage: z.enum(OUTPUT_LANGUAGES).default("ko"),
  languageHint: z.string().trim().min(2).max(8).optional(),
});
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

export function buildMeetingRecord(caller: Caller, input: CreateMeetingInput, now = new Date()): MeetingRecord {
  const meetingId = randomUUID();
  const createdAt = now.toISOString();
  const title = input.title ?? input.fileName.replace(/\.mp3$/i, "") ?? "회의";
  return {
    ...meetingKeys.meeting(meetingId),
    GSI1PK: meetingKeys.userGsi(caller.sub),
    GSI1SK: createdAt,
    meetingId,
    owner: caller.sub,
    ownerEmail: caller.email,
    title,
    status: "UPLOAD_PENDING",
    stages: {},
    audioKey: s3Keys.upload(caller.sub, meetingId),
    fileName: input.fileName,
    fileSize: input.fileSize,
    contentType: input.contentType,
    outputLanguage: input.outputLanguage,
    languageHint: input.languageHint,
    createdAt,
    updatedAt: createdAt,
  };
}

export async function createMeeting(caller: Caller, input: CreateMeetingInput): Promise<CreateMeetingResponse> {
  const active = await countActiveMeetings(caller.sub);
  if (active >= CONSTRAINTS.maxActiveMeetingsPerUser) {
    throw new HttpError(429, `처리 중인 회의가 ${CONSTRAINTS.maxActiveMeetingsPerUser}건을 초과했습니다. 완료 후 다시 시도하세요.`, "too_many_active");
  }
  const rec = buildMeetingRecord(caller, input);
  const [plan, legacyUrl] = await Promise.all([createMultipartUpload(rec.audioKey, rec.contentType, rec.fileSize), presignUpload(rec.audioKey, rec.contentType)]);
  rec.uploadId = plan.uploadId;
  await putMeeting(rec);
  return {
    meeting: toMeetingDto(rec),
    upload: {
      method: "PUT",
      uploadId: plan.uploadId,
      partSize: plan.partSize,
      parts: plan.parts,
      completePath: `/meetings/${rec.meetingId}/complete-upload`,
      expiresAt: plan.expiresAt,
      // Stale clients (old service-worker bundle) still PUT the whole file here; the S3 event starts the pipeline as before.
      url: legacyUrl,
      headers: { "Content-Type": rec.contentType },
    },
  };
}

export const completeUploadSchema = z.object({
  uploadId: z.string().min(1).max(1024),
  parts: z.array(z.object({ partNumber: z.number().int().min(1).max(10000), etag: z.string().min(1).max(256) })).min(1).max(10000),
});

/** Finish the multipart upload; the S3 "Object Created" event then starts the pipeline for this meeting. */
export async function completeUpload(caller: Caller, meetingId: string, body: CompleteUploadRequest): Promise<void> {
  const rec = await requireOwnedMeeting(caller, meetingId);
  if (rec.status !== "UPLOAD_PENDING") throw new HttpError(409, "upload already completed", "already_uploaded");
  if (!rec.uploadId || rec.uploadId !== body.uploadId) throw new HttpError(400, "unknown upload id", "bad_upload_id");
  await completeMultipartUpload(rec.audioKey, rec.uploadId, body.parts);
}

export async function listMeetings(caller: Caller, cursor?: string) {
  const page = await listMeetingsByOwner(caller.sub, cursor);
  return { items: page.items.map(toMeetingDto), cursor: page.cursor ?? null };
}

export async function requireOwnedMeeting(caller: Caller, meetingId: string, consistentRead = false): Promise<MeetingRecord> {
  const rec = await getMeeting(meetingId, consistentRead);
  if (!rec || rec.owner !== caller.sub) throw new HttpError(404, "meeting not found", "not_found");
  return rec;
}

async function editDocument<T>(caller: Caller, meetingId: string, operation: (meeting: MeetingRecord) => Promise<T>): Promise<T> {
  await requireOwnedMeeting(caller, meetingId); // Reject foreign requests before they can acquire a lock.
  try {
    return await withDocumentLock(meetingId, async () => operation(await requireOwnedMeeting(caller, meetingId, true)));
  } catch (error) {
    if (error instanceof DocumentBusyError) throw new HttpError(409, error.message, "document_busy");
    throw error;
  }
}

export async function getMeetingResult(caller: Caller, meetingId: string): Promise<MeetingResultResponse> {
  const rec = await requireOwnedMeeting(caller, meetingId);
  const notes = rec.notesKey ? await readJson<NotesDocument>(rec.notesKey) : null;
  const attributedKey = s3Keys.attributedTranscript(meetingId);
  const attributed = rec.transcriptKey && rec.stages?.speaker_attribution?.status === "COMPLETED"
    ? await headObject(attributedKey) : null;
  const transcriptKey = attributed ? attributedKey : rec.transcriptKey;
  const [transcriptUrl, originalTranscriptUrl, audioUrl, notesMarkdownUrl] = await Promise.all([
    transcriptKey ? presignDownload(transcriptKey) : Promise.resolve(null),
    attributed && rec.transcriptKey ? presignDownload(rec.transcriptKey) : Promise.resolve(null),
    rec.status !== "UPLOAD_PENDING" ? presignDownload(rec.audioKey) : Promise.resolve(null),
    // Derive the markdown key from the stored document key so meetings finalized under the old key layout keep working.
    rec.notesKey ? presignDownload(rec.notesKey.replace(/\.json$/, ".md")) : Promise.resolve(null),
  ]);
  return { meeting: toMeetingDto(rec), notes, transcriptUrl, originalTranscriptUrl,
    transcriptRevision: attributed?.revision ?? rec.stages?.transcript_analysis?.startedAt ?? rec.createdAt, audioUrl, notesMarkdownUrl };
}

export async function removeMeeting(caller: Caller, meetingId: string): Promise<void> {
  return editDocument(caller, meetingId, async (rec) => {
    const running = [rec.executionArn && ACTIVE_STATUSES.includes(rec.status) ? rec.executionArn : null, rec.briefStatus === "RUNNING" ? rec.briefExecutionArn : null];
    for (const executionArn of running) {
      if (!executionArn || !apiEnv.stateMachineArn) continue;
      try {
        await sfn.send(new StopExecutionCommand({ executionArn, cause: "deleted by user" }));
      } catch (err) {
        if ((err as { name?: string }).name !== "ExecutionDoesNotExist") throw err;
      }
    }
    if (rec.uploadId && rec.status === "UPLOAD_PENDING") await abortMultipartUpload(rec.audioKey, rec.uploadId).catch(() => undefined);
    // Memory first: if this fails the meeting stays visible and the user can delete again.
    if (apiEnv.memoryId) await deleteMeetingMemory(apiEnv.memoryId, rec.owner, meetingId, rec.title);
    await Promise.all([
      deletePrefix(s3Keys.meetingPrefix(caller.sub, meetingId)),
      deletePrefix(`transcripts/${meetingId}/`),
      deletePrefix(`results/${meetingId}/`),
    ]);
    await deleteMeeting(meetingId);
  });
}

/** Restart the pipeline for a FAILED meeting; the state machine skips steps whose outputs already exist. */
export async function retryMeeting(caller: Caller, meetingId: string): Promise<{ executionArn: string }> {
  const rec = await requireOwnedMeeting(caller, meetingId);
  if (rec.status !== "FAILED") throw new HttpError(409, "실패한 회의만 다시 시도할 수 있습니다", "not_failed");
  if (!apiEnv.stateMachineArn) throw new HttpError(500, "pipeline not configured", "no_state_machine");
  const token = randomUUID();
  if (!(await claimRetry(meetingId, token))) throw new HttpError(409, "이미 다시 시도가 진행 중입니다", "retry_in_progress");
  try {
    const res = await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: apiEnv.stateMachineArn,
        name: `retry-${meetingId.slice(0, 8)}-${token.slice(0, 8)}`,
        input: JSON.stringify({ retry: { meetingId } }),
      }),
    );
    return { executionArn: res.executionArn ?? "" };
  } catch (err) {
    await releaseRetry(meetingId).catch(() => undefined);
    throw err;
  }
}

/** Add the new recap to a published meeting without rerunning STT or any detailed analysis. */
export async function createMeetingBrief(caller: Caller, meetingId: string): Promise<{ executionArn: string }> {
  const rec = await requireOwnedMeeting(caller, meetingId);
  if (rec.status !== "COMPLETED" || !rec.notesKey || !rec.transcriptKey) throw new HttpError(409, "분석이 끝난 회의에 추가 요약을 만들 수 있습니다", "not_completed");
  const doc = await readJson<NotesDocument>(rec.notesKey);
  if (!doc || doc.meetingId !== meetingId) throw new HttpError(404, "회의록을 찾을 수 없습니다", "not_found");
  if (doc.brief) throw new HttpError(409, "추가 요약이 이미 있습니다", "brief_exists");
  if (rec.briefStatus === "RUNNING") throw new HttpError(409, "추가 요약을 만드는 중입니다", "brief_in_progress");
  if (!apiEnv.stateMachineArn) throw new HttpError(500, "pipeline not configured", "no_state_machine");
  if (await countActiveMeetings(caller.sub) >= CONSTRAINTS.maxActiveMeetingsPerUser) throw new HttpError(429, "처리 중인 회의가 많습니다. 완료 후 다시 시도하세요.", "too_many_active");
  const token = randomUUID();
  if (!(await claimRetry(meetingId, token, "COMPLETED"))) throw new HttpError(409, "추가 요약이 이미 요청되었습니다", "retry_in_progress");
  try {
    const res = await sfn.send(new StartExecutionCommand({
      stateMachineArn: apiEnv.stateMachineArn,
      name: `brief-${meetingId.slice(0, 8)}-${token.slice(0, 8)}`,
      input: JSON.stringify({ retry: { meetingId, briefOnly: true } }),
    }));
    // Visible to the client before RegisterUpload runs, so polling starts right away; the meeting stays COMPLETED.
    await markBriefRun(meetingId, res.executionArn ?? "").catch((error: unknown) => console.warn("brief run marker failed (register will set it)", String(error)));
    return { executionArn: res.executionArn ?? "" };
  } catch (err) {
    await releaseRetry(meetingId, token).catch(() => undefined);
    throw err;
  }
}

export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 32);
}

export const updateMeetingSchema = z.object({ title: z.string().trim().min(1).max(200) });

/**
 * Rename a meeting. A published document (even one from an earlier run of a meeting being re-analysed) is rewritten
 * first so document.json/.md and the KB sidecars follow the record, then the record itself. All writers share
 * the same lock and read the current state after acquiring it, including Finalize and speaker edits.
 */
export async function updateMeetingTitle(caller: Caller, meetingId: string, body: z.infer<typeof updateMeetingSchema>): Promise<{ meeting: MeetingDto }> {
  return editDocument(caller, meetingId, async (rec) => {
    if (rec.notesKey) {
      const doc = await readJson<NotesDocument>(rec.notesKey);
      if (!doc || doc.meetingId !== meetingId) throw new HttpError(409, "회의록을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.", "document_unavailable");
      // Re-publish derivatives even on an idempotent retry after a partial S3 failure.
      await putFinalDocument(rec.owner, { ...doc, title: body.title }, rec.notesKey);
    }
    await setMeetingTitle(meetingId, body.title);
    return { meeting: toMeetingDto({ ...rec, title: body.title }) };
  });
}

export const updateSpeakersSchema = z.object({ labels: z.record(z.string().regex(/^S\d{1,3}$/), z.string().trim().min(1).max(40)).refine((o) => Object.keys(o).length > 0 && Object.keys(o).length <= 20, "1 to 20 speakers") });

/** Rename speakers of a finished meeting; rewrites document.json/.md and the KB sidecars (which re-trigger ingestion). */
export async function renameSpeakers(caller: Caller, meetingId: string, body: z.infer<typeof updateSpeakersSchema>): Promise<{ speakers: NotesDocument["speakers"] }> {
  return editDocument(caller, meetingId, async (rec) => {
    if (rec.status !== "COMPLETED" || !rec.notesKey) throw new HttpError(409, "분석이 끝난 회의만 화자 이름을 바꿀 수 있습니다", "not_completed");
    const doc = await readJson<NotesDocument>(rec.notesKey);
    if (!doc || doc.meetingId !== meetingId) throw new HttpError(404, "document not found", "not_found");
    const { doc: updated } = applySpeakerLabels(doc, body.labels);
    await putFinalDocument(rec.owner, updated, rec.notesKey);
    return { speakers: updated.speakers };
  });
}
