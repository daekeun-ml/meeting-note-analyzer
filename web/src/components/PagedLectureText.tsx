import { useEffect, useMemo, useRef, useState } from "react";
import { paginateLectureText } from "../lib/lecture-pagination";
import { LectureText } from "./MathText";
import { Button } from "./ui";

export function PagedLectureText({ text, label = "요약", className = "" }: { text: string; label?: string; className?: string }) {
  const pages = useMemo(() => paginateLectureText(text), [text]);
  const [selected, setSelected] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => setSelected(0), [text]);
  const index = Math.min(selected, pages.length - 1);
  function select(next: number) {
    setSelected(next);
    top.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }
  function navigation(bottom = false) {
    return <nav aria-label={`${label} ${bottom ? "하단 " : ""}페이지 이동`} className={`flex flex-wrap items-center gap-2 ${bottom ? "mt-4 border-t border-line pt-3" : "mb-4"}`}>
      <Button size="sm" variant="secondary" disabled={!index} onClick={() => select(index - 1)}>이전</Button>
      {!bottom && <select aria-label={`${label} 페이지 선택`} className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 p-2 text-sm"
        value={index} onChange={(event) => select(Number(event.target.value))}>
        {pages.map((page, i) => <option key={i} value={i}>{page.label}</option>)}
      </select>}
      <span className="text-xs text-ink-3 tabular-nums" aria-live="polite">{index + 1} / {pages.length}</span>
      <Button size="sm" variant="secondary" disabled={index === pages.length - 1} onClick={() => select(index + 1)}>다음</Button>
    </nav>;
  }
  return <div ref={top} className={`scroll-mt-24 ${className}`}>
    {pages.length > 1 && navigation()}
    <LectureText text={pages[index]!.text} />
    {pages.length > 1 && navigation(true)}
  </div>;
}
