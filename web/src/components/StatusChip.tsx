import type { MeetingStatus } from "@meeting-notes/shared";
import { Pill } from "./ui";

const map: Record<MeetingStatus, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger"; pulse?: boolean }> = {
  UPLOAD_PENDING: { label: "업로드 대기", tone: "neutral", pulse: true },
  UPLOADED: { label: "업로드 완료", tone: "neutral", pulse: true },
  TRANSCRIBING: { label: "전사 중", tone: "warning", pulse: true },
  ANALYZING: { label: "분석 중", tone: "accent", pulse: true },
  COMPLETED: { label: "완료", tone: "success" },
  FAILED: { label: "실패", tone: "danger" },
};

export function StatusChip({ status }: { status: MeetingStatus }) {
  const m = map[status];
  return <Pill tone={m.tone} dot pulse={m.pulse}>{m.label}</Pill>;
}
