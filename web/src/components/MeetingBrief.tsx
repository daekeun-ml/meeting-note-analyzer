import { useState } from "react";
import { briefFollowUps, briefToMarkdown, type NotesDocument } from "@meeting-notes/shared";
import { IconCheck, IconChevronRight, IconDoc } from "./icons";
import { Button, InlineError } from "./ui";

export function MeetingBrief({ doc, onGenerate, generating, generationError, onDetails }: {
  doc: NotesDocument;
  onGenerate?: () => void;
  generating?: boolean;
  generationError?: string;
  onDetails: (tab: "agenda" | "followups") => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const b = doc.brief;
  const actions = briefFollowUps(doc);
  async function copy() {
    setCopyError(false); setCopied(false);
    try {
      await navigator.clipboard.writeText(briefToMarkdown(doc));
      setCopied(true);
    } catch { setCopyError(true); }
  }
  return (
    <section id="meeting-brief" tabIndex={-1} aria-labelledby="meeting-brief-title" className="mt-8 mb-4 scroll-mt-4 overflow-hidden rounded-2xl border border-accent/35 bg-surface shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <header className="border-b border-line px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-accent">회의의 핵심</p>
            <h2 id="meeting-brief-title" className="mt-1 text-[20px] font-bold tracking-tight">한눈에 보는 요약</h2>
          </div>
          {b && <Button size="sm" variant="secondary" icon={copied ? <IconCheck size={15} /> : <IconDoc size={15} />} onClick={() => void copy()}>{copied ? "복사됨" : "요약 복사"}</Button>}
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-2">무엇을 결정했고, 왜 그렇게 정했는지.</p>
        <span role="status" className="sr-only">{copied ? "요약을 복사했습니다" : ""}</span>
        {copyError && <InlineError>복사하지 못했습니다. 요약 내용을 선택해 복사하세요.</InlineError>}
      </header>
      {!b ? <div className="px-5 py-5">
        <p className="text-sm leading-relaxed text-ink-2">상세 회의록에서 핵심 결론과 결정 과정을 짧게 정리합니다.</p>
        {onGenerate && <Button className="mt-4" full onClick={onGenerate} loading={generating}>추가 요약 만들기</Button>}
        {generating && <p role="status" className="mt-3 text-sm text-accent">추가 요약을 만들고 있습니다. 완료되면 여기에 표시됩니다.</p>}
        {generationError && <InlineError>{generationError}</InlineError>}
      </div> : <div className="divide-y divide-line">
        <div className="px-5 py-5">
          <BriefLabel number="01">핵심 결론</BriefLabel>
          <p className="mt-3 text-[18px] font-semibold leading-relaxed break-words">{b.headline}</p>
        </div>
        <div className="px-5 py-5">
          <BriefLabel number="02">주요 결정과 결정 과정</BriefLabel>
          <ol className="mt-4 space-y-5">{b.decisions.map((d) => <li key={`${d.agendaId}-${d.decisionIndex}`}>
            <p className="flex gap-2 text-[15px] font-semibold leading-relaxed"><IconCheck size={17} className="mt-1 shrink-0 text-success" /><span className="min-w-0 break-words">{d.decision}</span></p>
            <p className={`mt-2 pl-[25px] text-[14px] leading-relaxed break-words ${d.rationaleStatus === "supported" ? "text-ink-2" : "text-warning"}`}>{d.rationaleStatus === "supported" && d.process ? d.process : "결정 근거 미확인"}</p>
            {!!d.evidence.length && <details className="mt-2 pl-[25px] text-[12px] text-ink-2">
              <summary className="cursor-pointer py-1 text-accent">근거 발언 {d.evidence.length}개</summary>
              <ul className="mt-2 space-y-2">{d.evidence.map((e) => <li key={e.segmentId} className="border-l-2 border-line-2 pl-3">
                <p className="text-ink-3">{Math.floor(e.start / 60)}:{String(Math.floor(e.start % 60)).padStart(2, "0")} · {doc.speakers.find((s) => s.id === e.speaker)?.label ?? e.speaker}</p>
                <p className="mt-1 leading-relaxed break-words">{e.text}</p>
              </li>)}</ul>
            </details>}
          </li>)}</ol>
          {!b.decisions.length && <EmptyLine>확정된 결정 사항이 없습니다.</EmptyLine>}
          {b.omittedCounts.decisions > 0 && <MoreLink onClick={() => onDetails("agenda")}>결정 사항 {b.omittedCounts.decisions}개 더 보기</MoreLink>}
        </div>
        <div className="px-5 py-5">
          <BriefLabel number="03">해야 할 일</BriefLabel>
          <ul className="mt-4 space-y-4">{actions.map((f) => <li key={f.id}>
            <p className="text-[15px] font-medium leading-relaxed break-words">{f.title}</p>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2"><span>담당 <span className="text-ink">{f.ownerName || "미정"}</span></span><span>기한 <span className="text-ink">{f.dueHint || "미정"}</span></span></p>
          </li>)}</ul>
          {!actions.length && <EmptyLine>기록된 후속 조치가 없습니다.</EmptyLine>}
          {b.omittedCounts.followUps > 0 && <MoreLink onClick={() => onDetails("followups")}>할 일 {b.omittedCounts.followUps}개 더 보기</MoreLink>}
        </div>
        <div className="px-5 py-5">
          <BriefLabel number="04">미결 사항</BriefLabel>
          <ul className="mt-3 space-y-2">{b.openQuestions.map((q) => <li key={`${q.agendaId}-${q.questionIndex}`} className="flex gap-2 text-[14px] leading-relaxed"><span className="text-warning" aria-hidden>?</span><span className="min-w-0 break-words">{q.question}</span></li>)}</ul>
          {!b.openQuestions.length && <EmptyLine>{b.omittedCounts.openQuestions > 0 ? "남은 질문은 상세 내용에서 확인하세요." : "기록된 미결 사항이 없습니다."}</EmptyLine>}
          {b.omittedCounts.openQuestions > 0 && <MoreLink onClick={() => onDetails("agenda")}>미결 사항 {b.omittedCounts.openQuestions}개 더 보기</MoreLink>}
        </div>
      </div>}
    </section>
  );
}

function BriefLabel({ number, children }: { number: string; children: React.ReactNode }) {
  return <h3 className="flex items-baseline gap-2 text-[13px] font-semibold text-ink-2"><span className="text-[11px] tabular-nums text-accent">{number}</span>{children}</h3>;
}
function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[13px] text-ink-3">{children}</p>;
}
function MoreLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button type="button" className="tap mt-3 inline-flex items-center gap-1 py-2 text-[12px] text-accent" onClick={onClick}>{children}<IconChevronRight size={13} /></button>;
}
