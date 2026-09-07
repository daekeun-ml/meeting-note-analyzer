import type { NotesDocument } from "./stages.js";

export function briefFollowUps(doc: NotesDocument): NotesDocument["followUps"] {
  return (doc.brief?.followUpIds ?? []).flatMap((id) => {
    const item = doc.followUps.find((f) => f.id === id);
    return item ? [{ ...item, ownerName: item.ownerName || doc.speakers.find((s) => s.id === item.ownerSpeakerId)?.label }] : [];
  });
}

/** Shared by the copy button and the complete Markdown export. Never reconstruct missing decision reasons. */
export function briefToMarkdown(doc: NotesDocument): string {
  if (!doc.brief) return "";
  const b = doc.brief;
  const en = (doc.outputLanguage === "auto" ? doc.detectedLanguage : doc.outputLanguage) === "en";
  const t = en
    ? { title: "Meeting at a glance", outcome: "Core outcome", decisions: "Decisions and reasoning", actions: "Action items", questions: "Open questions", unknownReason: "Decision rationale not recorded", unknown: "Not specified", owner: "Owner", due: "Due", noDecisions: "No confirmed decisions recorded.", noActions: "No action items recorded.", noQuestions: "No unresolved questions recorded.", more: "Additional items are available in the detailed notes" }
    : { title: "한눈에 보는 요약", outcome: "핵심 결론", decisions: "주요 결정과 결정 과정", actions: "해야 할 일", questions: "미결 사항", unknownReason: "결정 근거 미확인", unknown: "미정", owner: "담당", due: "기한", noDecisions: "확정된 결정 사항이 없습니다.", noActions: "기록된 후속 조치가 없습니다.", noQuestions: "기록된 미결 사항이 없습니다.", more: "나머지 항목은 상세 내용에서 확인할 수 있습니다" };
  const out = [`## ${t.title}`, "", `### ${t.outcome}`, b.headline, "", `### ${t.decisions}`];
  for (const d of b.decisions) out.push(`- ${d.decision}`, `  ${d.rationaleStatus === "supported" && d.process ? d.process : t.unknownReason}`);
  if (!b.decisions.length) out.push(t.noDecisions);
  out.push("", `### ${t.actions}`);
  const actions = briefFollowUps(doc);
  for (const f of actions) out.push(`- ${f.title} (${t.owner}: ${f.ownerName || t.unknown}, ${t.due}: ${f.dueHint || t.unknown})`);
  if (!actions.length) out.push(t.noActions);
  out.push("", `### ${t.questions}`);
  out.push(...(b.openQuestions.length ? b.openQuestions.map((q) => `- ${q.question}`) : [b.omittedCounts.openQuestions > 0 ? (en ? "See the detailed notes for remaining questions." : "남은 질문은 상세 내용에서 확인하세요.") : t.noQuestions]));
  if (Object.values(b.omittedCounts).some((n) => n > 0)) out.push("", t.more + ".");
  return out.join("\n") + "\n";
}
