import { LECTURE_STAGES, LECTURE_STAGE_LABELS, type LectureDto } from "@meeting-notes/shared";
import { Pill, ProgressBar } from "./ui";

const LABELS: Record<LectureDto["status"], string> = { UPLOAD_PENDING: "업로드 대기", UPLOADED: "처리 대기", PREPARING: "영상 처리 중", TRANSCRIBING: "전사 중", ANALYZING: "분석 중", COMPLETED: "학습 준비 완료", FAILED: "처리 실패" };
export function LectureStatus({ lecture }: { lecture: LectureDto }) {
  return <Pill tone={lecture.status === "COMPLETED" ? "success" : lecture.status === "FAILED" ? "danger" : "accent"} dot>{LABELS[lecture.status]}</Pill>;
}
export function LectureProgress({ lecture }: { lecture: LectureDto }) {
  return <ol className="space-y-3" aria-label="강의 처리 단계">{LECTURE_STAGES.map((stage) => {
    const state = lecture.stages[stage];
    return <li key={stage} className="text-[13px]">
      <div className="flex justify-between mb-1.5"><span className={state?.status === "COMPLETED" ? "text-success" : "text-ink-2"}>{LECTURE_STAGE_LABELS[stage]}</span><span className="text-ink-3">{state?.status === "COMPLETED" ? "완료" : state?.total ? `${state.completed ?? 0} / ${state.total}` : lecture.currentStage === stage ? "처리 중" : "대기"}</span></div>
      <ProgressBar value={state?.status === "COMPLETED" ? 100 : state?.total ? 100 * (state.completed ?? 0) / state.total : 0} />
    </li>;
  })}</ol>;
}
