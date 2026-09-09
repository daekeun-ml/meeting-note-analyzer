import { briefToMarkdown, type NotesDocument } from "@meeting-notes/shared";

const L = {
  ko: { summary: "요약", decisions: "결정 사항", discussions: "핵심 논의", risks: "리스크와 이슈", next: "다음 단계", agenda: "안건", notes: "노트", followUps: "F/U 항목", suggestions: "AI 제안", speakers: "참석자", owner: "담당", due: "기한", priority: "우선순위", carried: "이월", alternatives: "대안", nextSteps: "다음 단계", risksLabel: "리스크", questions: "확인 질문", conflict: "과거 결정과의 충돌", mindmap: "마인드맵", coverage: "검증", minutes: "분" },
  en: { summary: "Summary", decisions: "Decisions", discussions: "Key discussions", risks: "Risks and issues", next: "Next steps", agenda: "Agenda", notes: "Notes", followUps: "Follow-ups", suggestions: "AI suggestions", speakers: "Participants", owner: "Owner", due: "Due", priority: "Priority", carried: "carried over", alternatives: "Alternatives", nextSteps: "Next steps", risksLabel: "Risks", questions: "Clarifying questions", conflict: "Conflicts with past decisions", mindmap: "Mind map", coverage: "Verification", minutes: "min" },
};

export function notesToMarkdown(doc: NotesDocument): string {
  const t = doc.outputLanguage === "en" ? L.en : L.ko;
  const out: string[] = [`# ${doc.title}`, "", `_${doc.generatedAt.slice(0, 16).replace("T", " ")}, ${Math.round(doc.durationSec / 60)} ${t.minutes}, ${doc.meetingType}_`, ""];
  out.push(`## ${t.speakers}`, ...doc.speakers.map((s) => `- ${s.label}${s.role ? `: ${s.role}` : ""}${s.reviewRequired && !s.nameConfirmedByUser ? " [speaker name review required]" : ""}`), "");
  out.push(`## ${t.summary}`, doc.summary.overview, "");
  if (doc.summary.keyDecisions.length) out.push(`### ${t.decisions}`, ...doc.summary.keyDecisions.map((d) => `- ${d}`), "");
  if (doc.summary.keyDiscussions.length) out.push(`### ${t.discussions}`, ...doc.summary.keyDiscussions.map((d) => `- **${d.title}**: ${d.detail}`), "");
  if (doc.summary.risksAndIssues.length) out.push(`### ${t.risks}`, ...doc.summary.risksAndIssues.map((d) => `- ${d}`), "");
  if (doc.summary.nextSteps.length) out.push(`### ${t.next}`, ...doc.summary.nextSteps.map((d) => `- ${d}`), "");
  out.push(`## ${t.agenda}`);
  for (const a of doc.agenda) {
    out.push(`### ${a.title}`, a.background, "");
    if (a.discussionPoints.length) out.push(...a.discussionPoints.map((p) => `- ${p}`), "");
    if (a.decisions.length) out.push(`**${t.decisions}**`, ...a.decisions.map((p) => `- ${p}`), "");
    if (a.openQuestions.length) out.push(`**${t.questions}**`, ...a.openQuestions.map((p) => `- ${p}`), "");
  }
  out.push(`## ${t.notes}`, doc.notes.markdown, "");
  out.push(`## ${t.followUps}`);
  for (const f of doc.followUps) {
    const meta = [f.ownerName ? `${t.owner}: ${f.ownerName}` : null, f.dueHint ? `${t.due}: ${f.dueHint}` : null, `${t.priority}: ${f.priority}`, f.status === "carried_over" ? t.carried : null].filter(Boolean).join(", ");
    out.push(`- [ ] ${f.title} _(${meta})_`);
  }
  out.push("", `## ${t.suggestions}`);
  for (const s of doc.suggestions) {
    out.push(`### ${s.target.title}`, s.suggestion, "");
    if (s.alternatives.length) out.push(`**${t.alternatives}**`, ...s.alternatives.map((x) => `- ${x}`), "");
    if (s.nextSteps.length) out.push(`**${t.nextSteps}**`, ...s.nextSteps.map((x) => `- ${x}`), "");
    if (s.risks.length) out.push(`**${t.risksLabel}**`, ...s.risks.map((x) => `- ${x}`), "");
    if (s.clarifyingQuestions.length) out.push(`**${t.questions}**`, ...s.clarifyingQuestions.map((x) => `- ${x}`), "");
    if (s.conflictsWithPast) out.push(`> ${t.conflict}: ${s.conflictsWithPast}`, "");
  }
  if (doc.mindmap) {
    out.push(`## ${t.mindmap}`);
    if (doc.mindmap.coverage) {
      const c = doc.mindmap.coverage;
      out.push(`_${t.coverage}: ${t.agenda} ${Math.round(c.agenda * 100)}%, ${t.followUps} ${Math.round(c.followUps * 100)}%, ${t.decisions} ${Math.round(c.decisions * 100)}%_`, "");
    }
    if (doc.mindmap.mermaid) out.push("```mermaid", doc.mindmap.mermaid.trimEnd(), "```", "");
    if (doc.mindmap.outline) out.push(doc.mindmap.outline.trimEnd(), "");
  }
  if (doc.brief) out.push(briefToMarkdown(doc));
  return out.join("\n") + "\n";
}
