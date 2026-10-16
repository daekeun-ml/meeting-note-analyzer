import type { LectureMathNote } from "@meeting-notes/shared";
import { useState } from "react";
import { MathText } from "./MathText";
import { Button } from "./ui";

const NOTE_KIND = { definition: "정의", theorem: "정리", lemma: "보조정리", formula: "공식", example: "예제" } as const;
const CHECK_LABEL = { consistent: "원본 검토", corrected: "원본 오류 수정", uncertain: "원본 확인 필요" } as const;

export function LectureMathNotes({ notes, paginated = false }: { notes: LectureMathNote[]; paginated?: boolean }) {
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, Math.max(0, notes.length - 1));
  const visible = paginated ? notes.slice(index, index + 1) : notes;
  return <div className="space-y-5">
    {paginated && notes.length > 1 && <nav aria-label="수식 이동" className="flex items-center gap-2">
      <Button size="sm" variant="secondary" disabled={!index} onClick={() => setSelected(index - 1)}>이전 수식</Button>
      <select aria-label="수식 선택" value={index} onChange={(event) => setSelected(Number(event.target.value))} className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-2 text-sm">{notes.map((note, i) => <option key={i} value={i}>{i + 1}. {note.name}</option>)}</select>
      <span className="text-xs text-ink-3">{index + 1} / {notes.length}</span>
      <Button size="sm" variant="secondary" disabled={index === notes.length - 1} onClick={() => setSelected(index + 1)}>다음 수식</Button>
    </nav>}
    {visible.map((note, i) => <section key={i} className="border-t border-line pt-4 first:border-0 first:pt-0">
    <h4 className="text-sm font-semibold"><span className="mr-2 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] text-accent">{NOTE_KIND[note.kind]}</span><MathText text={note.name} /></h4>
    {note.sourceCheck && <div className={`mt-3 rounded-xl border p-3 text-sm leading-relaxed ${note.sourceCheck.status === "consistent" ? "border-line text-ink-2" : "border-warning/40 bg-warning-soft"}`}>
      <p className="font-semibold">{CHECK_LABEL[note.sourceCheck.status]}</p>
      <p className="mt-1 whitespace-pre-wrap"><MathText text={note.sourceCheck.explanation} /></p>
    </div>}
    <div className="mt-2 rounded-xl bg-surface-2 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
      <p className="mb-1 text-xs text-ink-3">원본 식·명제</p><MathText text={note.statement} />
    </div>
    {note.sourceCheck?.correctedStatement && <div className="mt-2 text-sm leading-relaxed"><p className="text-xs text-ink-3">{note.sourceCheck.status === "corrected" ? "수정식" : "검토할 해석"}</p><MathText text={note.sourceCheck.correctedStatement} /></div>}
    {!!note.symbols?.length && <div className="mt-3"><p className="text-sm font-semibold">기호의 뜻</p><dl className="mt-2 space-y-2 text-sm">{note.symbols.map((item, j) => <div key={j} className="flex gap-3"><dt className="shrink-0"><MathText text={item.symbol} /></dt><dd className="min-w-0 text-ink-2"><MathText text={item.meaning} /></dd></div>)}</dl></div>}
    {!!note.assumptions?.length && <div className="mt-3"><p className="text-sm font-semibold">성립 조건</p><ul className="mt-1 list-disc pl-5 space-y-1 text-sm text-ink-2">{note.assumptions.map((item, j) => <li key={j}><MathText text={item} /></li>)}</ul></div>}
    {!!note.steps.length && <div className="mt-3"><p className="text-sm font-semibold">단계별 유도</p><ol className="mt-2 space-y-2">{note.steps.map((step, j) => <li key={j} className="flex gap-2 text-sm leading-relaxed"><span className="shrink-0 text-accent tabular-nums">{j + 1}.</span><span className="min-w-0 whitespace-pre-wrap"><MathText text={step} /></span></li>)}</ol></div>}
    {note.intuition && <p className="mt-3 text-sm leading-relaxed text-ink-2 whitespace-pre-wrap"><span className="font-semibold text-ink">직관과 예시 </span><MathText text={note.intuition} /></p>}
    {note.supplementary && <p className="mt-2 text-xs text-ink-3">강의에서 생략된 증명을 보충했습니다. 추가 유도와 예시는 학습을 위한 AI 설명입니다.</p>}
  </section>)}</div>;
}
