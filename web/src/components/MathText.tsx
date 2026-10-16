import { useMemo } from "react";
import katex from "katex";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { Root } from "mdast";
import "katex/dist/katex.min.css";
import { lectureMarkdown } from "../lib/lecture-text";

const OPTIONS = { throwOnError: false, trust: false, strict: "ignore" as const, maxExpand: 1000, maxSize: 50 };
const components: Components = {
  img: ({ alt }) => <span>{alt}</span>,
  a: ({ children, href }) => href ? <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline break-words">{children}</a> : <span>{children}</span>,
  table: ({ children }) => <div className="overflow-x-auto"><table>{children}</table></div>,
};

/** Keep legacy $$...$$ displays even when placed inside a paragraph. */
function legacyDisplays() {
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    type Node = { type: string; children?: Node[]; position?: { start: { offset?: number } }; data?: Record<string, unknown> };
    function visit(node: Node) {
      const offset = node.position?.start.offset ?? 0;
      if (node.type === "inlineMath" && source.slice(offset, offset + 2) === "$$") {
        node.data = { ...node.data, hProperties: { className: ["language-math", "math-display"] } };
      }
      for (const child of node.children ?? []) visit(child);
    }
    visit(tree as Node);
  };
}
const plugins = [remarkGfm, remarkMath, legacyDisplays];

/** Used by chat after its evidence-aware parser has isolated a formula. */
export function MathFormula({ expression, display = false }: { expression: string; display?: boolean }) {
  const html = useMemo(() => katex.renderToString(expression.trim(), { ...OPTIONS, displayMode: display }), [expression, display]);
  return <span className={display ? "block overflow-x-auto py-1" : "inline-block max-w-full overflow-x-auto align-middle"} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Compact rich text for labels, bullets, and formula fields already in a container. */
export function MathText({ text, className = "" }: { text: string; className?: string }) {
  const source = useMemo(() => lectureMarkdown(text), [text]);
  return <span className={`lecture-markdown lecture-inline ${className}`}>
    <Markdown remarkPlugins={plugins} rehypePlugins={[[rehypeKatex, OPTIONS]]} components={{
      ...components, p: ({ children }) => <span>{children}</span>,
      pre: ({ children }) => <span className="block whitespace-pre-wrap font-mono">{children}</span>,
    }}>{source}</Markdown>
  </span>;
}

/** Full Markdown and math, shared by owner, guest, and PDF views. */
export function LectureText({ text, className = "" }: { text: string; className?: string }) {
  const source = useMemo(() => lectureMarkdown(text), [text]);
  return <div className={`lecture-markdown leading-relaxed [overflow-wrap:anywhere] ${className}`}>
    <Markdown remarkPlugins={plugins} rehypePlugins={[[rehypeKatex, OPTIONS]]} components={components}>{source}</Markdown>
  </div>;
}
