import { getMeeting, notifyUser } from "@meeting-notes/backend";
import { pipelineEnv } from "../lib/env.js";
import { updateMeeting } from "../lib/meeting-updates.js";

export interface MarkFailedInput {
  meetingId?: string;
  ownerSub?: string;
  title?: string;
  outputLanguage?: string;
  errorOutput?: { Error?: string; Cause?: string };
}

export function describeError(e?: { Error?: string; Cause?: string }): string {
  const err = e?.Error ?? "UnknownError";
  let cause = e?.Cause ?? "";
  try {
    const parsed = JSON.parse(cause) as { errorMessage?: string };
    if (parsed.errorMessage) cause = parsed.errorMessage;
  } catch {
    /* plain string cause */
  }
  return `${err}${cause ? `: ${cause}` : ""}`.slice(0, 1000);
}

export const handler = async (input: MarkFailedInput) => {
  if (!input.meetingId) return { marked: false };
  const meeting = await getMeeting(input.meetingId);
  if (!meeting) return { marked: false };
  const error = describeError(input.errorOutput);
  const stages = { ...meeting.stages };
  for (const [name, st] of Object.entries(stages)) {
    if (st?.status === "RUNNING") stages[name as keyof typeof stages] = { ...st, status: "FAILED", endedAt: new Date().toISOString(), error };
  }
  // A brief-only run failing leaves the published meeting COMPLETED; only the brief job is marked failed.
  if (meeting.briefOnly) await updateMeeting(input.meetingId, { briefStatus: "FAILED", briefError: error, stages }, undefined, ["briefExecutionArn"]);
  else await updateMeeting(input.meetingId, { status: "FAILED", error, stages });
  await notifyUser(meeting.owner, {
    title: meeting.briefOnly ? (meeting.outputLanguage === "en" ? "Meeting brief failed" : "추가 요약 생성에 실패했습니다") : (meeting.outputLanguage === "en" ? "Meeting analysis failed" : "회의 분석에 실패했습니다"),
    body: meeting.title,
    url: `${pipelineEnv.webOrigin}/meetings/${input.meetingId}`,
    tag: `meeting-${input.meetingId}`,
  });
  return { marked: true, error };
};
