import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getMeeting, s3 } from "@meeting-notes/backend";
import { CONSTRAINTS, parseUploadKey } from "@meeting-notes/shared";
import { setStatus, updateMeeting } from "../lib/meeting-updates.js";
import { resumePlan } from "../lib/resume.js";

export interface RegisterUploadInput {
  bucket?: string | null;
  key?: string | null;
  size?: number | null;
  executionArn: string;
  /** Set when the execution was started by the API to resume a FAILED meeting instead of by an S3 event. */
  retry?: { meetingId: string; briefOnly?: boolean } | null;
}
export interface RegisterUploadOutput {
  proceed: boolean;
  reason?: string;
  meetingId?: string;
  ownerSub?: string;
  title?: string;
  audioKey?: string;
  outputLanguage?: string;
  languageHint?: string;
  /** Resume mode: downstream steps skip work whose outputs already exist. */
  resume?: boolean;
  transcriptKey?: string;
  briefOnly?: boolean;
  documentKey?: string;
}

/** A declined claim must not leave the API's request token behind, or every later request is refused as "in progress". */
async function decline(meetingId: string, reason: string): Promise<RegisterUploadOutput> {
  try { await updateMeeting(meetingId, {}, undefined, ["retryToken"]); } catch (error) { console.warn("retry token release failed", String(error)); }
  return { proceed: false, reason };
}

/** Retry of a FAILED meeting (resume where it stopped), or a brief-only run on a COMPLETED meeting that stays COMPLETED. */
async function registerRetry(meetingId: string, executionArn: string, addBrief = false): Promise<RegisterUploadOutput> {
  const meeting = await getMeeting(meetingId);
  if (!meeting) return { proceed: false, reason: "unknown meeting" };
  const expectedStatus = addBrief ? "COMPLETED" : "FAILED";
  if (meeting.status !== expectedStatus) return decline(meetingId, `unexpected status=${meeting.status}`);
  if (addBrief && (!meeting.notesKey || !meeting.transcriptKey)) throw new Error("published meeting and transcript required for a brief");
  const plan = addBrief ? { hasTranscript: true, firstStage: "meeting_brief" as const } : resumePlan(meeting);
  const fields = addBrief
    ? { currentStage: plan.firstStage, briefOnly: true, briefStatus: "RUNNING", briefExecutionArn: executionArn }
    : { status: (plan as ReturnType<typeof resumePlan>).status, currentStage: plan.firstStage, executionArn };
  try {
    await updateMeeting(
      meetingId,
      fields,
      { expression: "#status = :expected", names: { "#status": "status" }, values: { ":expected": expectedStatus } },
      addBrief ? ["error", "retryToken", "briefError"] : ["error", "retryToken"],
    );
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") return decline(meetingId, "claimed by another execution");
    throw err;
  }
  return {
    proceed: true,
    meetingId,
    ownerSub: meeting.owner,
    title: meeting.title,
    audioKey: meeting.audioKey,
    outputLanguage: meeting.outputLanguage,
    languageHint: meeting.languageHint,
    resume: true,
    transcriptKey: plan.hasTranscript ? meeting.transcriptKey : undefined,
    briefOnly: addBrief,
    documentKey: addBrief ? meeting.notesKey : undefined,
  };
}

/** First pipeline step: validates the uploaded object and atomically claims the meeting for this execution. */
export const handler = async (input: RegisterUploadInput): Promise<RegisterUploadOutput> => {
  if (input.retry?.meetingId) return registerRetry(input.retry.meetingId, input.executionArn, input.retry.briefOnly);
  if (!input.key || !input.bucket) return { proceed: false, reason: "no object key in event" };
  const parsed = parseUploadKey(input.key);
  if (!parsed) return { proceed: false, reason: `not an upload key: ${input.key}` };
  const meeting = await getMeeting(parsed.meetingId);
  if (!meeting) return { proceed: false, reason: "unknown meeting" };
  if (meeting.owner !== parsed.ownerSub) return { proceed: false, reason: "owner mismatch" };
  if (meeting.status !== "UPLOAD_PENDING" && meeting.status !== "UPLOADED") {
    return { proceed: false, reason: `duplicate event (status=${meeting.status})` };
  }
  if ((input.size ?? 0) > CONSTRAINTS.maxUploadBytes) {
    // presigned PUT cannot cap size, so enforce it here and drop the object
    await s3.send(new DeleteObjectCommand({ Bucket: input.bucket, Key: input.key }));
    await setStatus(meeting.meetingId, "FAILED", { error: `file too large: ${input.size} bytes (max ${CONSTRAINTS.maxUploadBytes})` });
    return { proceed: false, reason: "file too large" };
  }
  try {
    await updateMeeting(
      meeting.meetingId,
      { status: "TRANSCRIBING", currentStage: "stt", executionArn: input.executionArn, fileSize: input.size ?? undefined },
      { expression: "#status IN (:s1, :s2)", names: { "#status": "status" }, values: { ":s1": "UPLOAD_PENDING", ":s2": "UPLOADED" } },
    );
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") return { proceed: false, reason: "claimed by another execution" };
    throw err;
  }
  return {
    proceed: true,
    meetingId: meeting.meetingId,
    ownerSub: meeting.owner,
    title: meeting.title,
    audioKey: meeting.audioKey,
    outputLanguage: meeting.outputLanguage,
    languageHint: meeting.languageHint,
  };
};
