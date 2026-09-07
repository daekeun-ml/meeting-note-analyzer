import { STAGES, type MeetingDto, type StageState } from "@meeting-notes/shared";
import { IconCheck, IconX, Spinner } from "./icons";
import { ProgressBar } from "./ui";

export const STAGE_LABELS: Record<string, string> = {
  stt: "음성 전사",
  transcript_analysis: "전사 분석",
  topic_segmentation: "맥락과 토픽 분리",
  speaker_attribution: "화자 식별",
  agenda: "안건 정리",
  summary: "회의 요약",
  notes: "노트 요약",
  follow_ups: "F/U 항목",
  suggestions: "AI 제안",
  mindmap: "마인드맵",
  meeting_brief: "핵심 요약과 결정 과정",
};

function elapsed(s?: StageState) {
  if (!s?.startedAt) return null;
  const ms = (s.endedAt ? new Date(s.endedAt).getTime() : Date.now()) - new Date(s.startedAt).getTime();
  const sec = Math.max(0, Math.round(ms / 1000));
  return sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;
}

export function StageProgress({ meeting }: { meeting: MeetingDto }) {
  const ALL = meeting.briefOnly ? ["meeting_brief"] : ["stt", ...STAGES];
  const stages = meeting.stages as Record<string, StageState | undefined>;
  const done = ALL.filter((s) => stages[s]?.status === "COMPLETED").length;
  const failed = meeting.status === "FAILED";
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-sm font-semibold">{failed ? "처리 중단" : `${done} / ${ALL.length} 단계 완료`}</p>
        <p className="text-xs text-ink-3">{Math.round((done / ALL.length) * 100)}%</p>
      </div>
      <ProgressBar value={(done / ALL.length) * 100} tone={done === ALL.length ? "success" : "accent"} />
      <ol className="mt-4 space-y-0.5">
        {ALL.map((s, i) => {
          const st = stages[s]?.status ?? (meeting.status === "TRANSCRIBING" && s === "stt" ? "RUNNING" : "PENDING");
          const running = st === "RUNNING";
          return (
            <li key={s} className="flex items-center gap-3 py-1.5">
              <span className="relative flex flex-col items-center">
                <StepIcon status={st} />
                {i < ALL.length - 1 && <span className={`absolute top-[26px] h-3 w-px ${st === "COMPLETED" ? "bg-success/50" : "bg-line-2"}`} />}
              </span>
              <span className={`flex-1 text-[14px] ${running ? "text-ink font-semibold" : st === "COMPLETED" ? "text-ink-2" : st === "FAILED" ? "text-danger" : "text-ink-3"}`}>{STAGE_LABELS[s]}</span>
              <span className="text-xs text-ink-3 tabular-nums">{running ? "진행 중" : elapsed(stages[s])}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepIcon({ status }: { status: string }) {
  if (status === "COMPLETED") return <span className="grid h-6 w-6 place-items-center rounded-full bg-success-soft text-success"><IconCheck size={14} strokeWidth={2.5} /></span>;
  if (status === "RUNNING") return <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-accent"><Spinner size={14} /></span>;
  if (status === "FAILED") return <span className="grid h-6 w-6 place-items-center rounded-full bg-danger-soft text-danger"><IconX size={14} strokeWidth={2.5} /></span>;
  return <span className="grid h-6 w-6 place-items-center"><span className="h-2.5 w-2.5 rounded-full border-[1.5px] border-line-2" /></span>;
}
