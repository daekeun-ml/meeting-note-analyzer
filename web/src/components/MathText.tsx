import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { LECTURE_TOKEN_SOURCE, lectureParagraphs, normalizeLectureText } from "../lib/lecture-text";

type Part = { text: string; html?: undefined; display?: undefined } | { text?: undefined; html: string; display: boolean };
// trust:false blocks \href, \url and \includegraphics; KaTeX escapes everything else, so its markup is safe to inject.
const OPTIONS = { throwOnError: false, trust: false, strict: "ignore" as const, maxExpand: 1000, maxSize: 50 };

/** A complete formula already isolated by a surrounding rich-text parser. */
export function MathFormula({ expression, display = false }: { expression: string; display?: boolean }) {
  const html = useMemo(() => katex.renderToString(expression.trim(), { ...OPTIONS, displayMode: display }), [expression, display]);
  return <span className={display ? "block overflow-x-auto py-1" : "inline-block max-w-full overflow-x-auto align-middle"} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Lecture text, including legacy escaping and both dollar/backslash math delimiters. */
export function MathText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => split(text), [text]);
  return <span className={`whitespace-pre-wrap ${className ?? ""}`}>{parts.map((part, i) => part.html === undefined ? part.text
    : <span key={i} className={part.display ? "block overflow-x-auto py-1" : undefined} dangerouslySetInnerHTML={{ __html: part.html }} />)}</span>;
}

/** Real paragraphs for long lecture descriptions, also used by guest and print views. */
export function LectureText({ text, className = "" }: { text: string; className?: string }) {
  const blocks = useMemo(() => lectureParagraphs(text), [text]);
  return <div className={`space-y-3 leading-relaxed [overflow-wrap:anywhere] ${className}`}>
    {blocks.map((block, i) => <p key={i}><MathText text={block} /></p>)}
  </div>;
}

function split(text: string): Part[] {
  text = normalizeLectureText(text);
  const parts: Part[] = []; const pattern = new RegExp(LECTURE_TOKEN_SOURCE, "g"); let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    const raw = match[0];
    if (raw.startsWith("`")) {
      parts.push({ text: raw });
    } else {
      const display = raw.startsWith("$$") || raw.startsWith("\\[");
      const delimiter = display || raw.startsWith("\\") ? 2 : 1;
      parts.push({ html: katex.renderToString(raw.slice(delimiter, -delimiter).trim(), { ...OPTIONS, displayMode: display }), display });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
