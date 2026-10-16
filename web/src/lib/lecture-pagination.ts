import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import type { RootContent } from "mdast";
import { lectureMarkdown } from "./lecture-text";

const parser = unified().use(remarkParse).use(remarkMath).use(remarkGfm);
export interface ReadingPage { text: string; label: string }

/** Split at real Markdown boundaries; formulas, tables and code blocks stay intact. */
export function paginateLectureText(text: string, limit = 1400): ReadingPage[] {
  const source = lectureMarkdown(text);
  const tree = parser.parse(source);
  const pages: ReadingPage[] = [];
  let parts: string[] = [], size = 0, title = "";
  function flush() {
    if (parts.length) pages.push({ text: parts.join("\n\n"), label: title || `내용 ${pages.length + 1}` });
    parts = []; size = 0; title = "";
  }
  function excerpt(node: { position?: { start: { offset?: number }; end: { offset?: number } } }) {
    return source.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? source.length);
  }
  function add(value: string) {
    if (size && size + value.length > limit) flush();
    parts.push(value); size += value.length;
  }
  for (const node of tree.children) {
    if (node.type === "definition" || node.type === "footnoteDefinition") continue;
    const heading = node.type === "heading" || (node.type === "paragraph" && node.children.length === 1 && node.children[0]?.type === "strong");
    if (heading) {
      if (size) flush();
      title = excerpt(node).replace(/^#+\s*|\*\*/g, "").slice(0, 70);
    }
    // Long lists split between whole items, preserving their original numbering.
    if (node.type === "list" && excerpt(node).length > limit) {
      for (const item of node.children) add(excerpt(item));
    } else add(excerpt(node));
  }
  flush();
  const definitions = tree.children.filter((n: RootContent) => n.type === "definition" || n.type === "footnoteDefinition").map(excerpt).join("\n\n");
  if (definitions) for (const page of pages) page.text += "\n\n" + definitions;
  return pages.length ? pages : [{ text: source, label: "내용 1" }];
}
