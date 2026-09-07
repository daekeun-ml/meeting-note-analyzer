import { STAGES, type MeetingRecord, type Stage } from "@meeting-notes/shared";

type StageMap = Record<string, { status?: string; s3Key?: string } | undefined>;

/** Where a failed meeting resumes: after STT when a normalized transcript exists, otherwise from STT. */
export function resumePlan(meeting: MeetingRecord): { hasTranscript: boolean; status: "TRANSCRIBING" | "ANALYZING"; firstStage: Stage | "stt" } {
  const stages = meeting.stages as StageMap;
  const hasTranscript = !!meeting.transcriptKey && stages["stt"]?.status === "COMPLETED";
  const firstStage: Stage | "stt" = hasTranscript ? (STAGES.find((s) => stages[s]?.status !== "COMPLETED") ?? STAGES[STAGES.length - 1]!) : "stt";
  return { hasTranscript, status: hasTranscript ? "ANALYZING" : "TRANSCRIBING", firstStage };
}

/** S3 key of a stage result that already completed in an earlier execution, or null when the stage must run. */
export function completedStageKey(meeting: MeetingRecord, stage: Stage): string | null {
  const st = (meeting.stages as StageMap)[stage];
  return st?.status === "COMPLETED" && st.s3Key ? st.s3Key : null;
}
