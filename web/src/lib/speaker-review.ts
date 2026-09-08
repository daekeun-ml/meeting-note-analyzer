import type { SpeakerCorrection } from "@meeting-notes/shared";

const issueLabels: Record<string, string> = {
  unconfirmed: "화자를 확정할 근거가 부족합니다.",
  context_only: "대화의 흐름만으로 추정한 제안입니다.",
  low_confidence: "모델이 판단을 확신하지 못했습니다.",
  invalid_evidence: "일부 인용을 원문에서 확인하지 못했습니다.",
  missing_evidence: "관련 화자의 직접적인 신원 근거가 부족합니다.",
  missing_segment_evidence: "이 발언에서 직접적인 신원 근거를 확인하지 못했습니다.",
  invalid_speaker: "원본에 없는 화자이거나 화자 참조가 잘못되었습니다.",
  invalid_segment: "해당 발언을 원본에서 찾지 못했습니다.",
  source_mismatch: "제안의 원래 화자가 전사와 일치하지 않습니다.",
  conflicting_proposals: "서로 겹치거나 충돌하는 보정 제안이 있습니다.",
  overlapping_speech: "동시에 발언한 구간이 있어 같은 화자로 합칠 수 없습니다.",
  ambiguous_identity: "서로 다른 화자에 같은 이름이 제안되었습니다.",
  invalid_label: "표시할 이름이 없습니다.",
};

export function reviewReasons(correction: SpeakerCorrection): string[] {
  return correction.issues.map((issue) => issueLabels[issue] ?? "화자 보정 근거를 확인해 주세요.");
}

export function correctionTitle(correction: SpeakerCorrection): string {
  if (correction.kind === "label") return `${correction.from.join(", ")} → ${correction.proposedLabel || "이름 미확인"} (이름)`;
  return `${correction.from.join(", ")} → ${correction.to} (${correction.kind === "merge" ? "화자 합치기" : "발언 화자"})`;
}
