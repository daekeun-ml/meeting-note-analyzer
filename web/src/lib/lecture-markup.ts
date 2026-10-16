/** Same boundary rules as lecture_study/math_markup.py; outer math protects nested code/URLs. */
export type MarkupSpan = { kind: "prose" | "math" | "code"; start: number; end: number };
const START = /`+|~{3,}|https?:\/\/|(?<![A-Za-z0-9_])[A-Za-z]:\\|\$+|\\[()[\]]/g;
const URL = /^https?:\/\/[^\s<>(){}]+/;
const PATH = /^[A-Za-z]:\\[^\s<>()]+/;

function escaped(text: string, index: number) {
  let start = index;
  while (start > 0 && text[start - 1] === "\\") start--;
  return (index - start) % 2 === 1;
}
function mathEnd(text: string, start: number, opener: string): number | undefined {
  const closing = ({ "$": "$", "$$": "$$", "\\(": "\\)", "\\[": "\\]" } as Record<string, string>)[opener]!;
  let position = start + opener.length;
  while (true) {
    const end = text.indexOf(closing, position);
    if (end < 0) return undefined;
    if (escaped(text, end)) { position = end + closing.length; continue; }
    const body = text.slice(start + opener.length, end);
    if (!body) return undefined;
    if (opener === "$") {
      if (text[end + 1] === "$" || body.includes("\n\n")) return undefined;
      const after = text.slice(end + 1, end + 2);
      if (/^\d/.test(body) && /^[A-Za-z0-9\\]/.test(after) && (/\s$/.test(body) || /[가-힣]/.test(body))) return undefined;
    }
    return end + closing.length;
  }
}

export function* markupSpans(text: string): Generator<MarkupSpan> {
  const starts = new RegExp(START.source, "g");
  let plain = 0, position = 0;
  while (position < text.length) {
    starts.lastIndex = position;
    const match = starts.exec(text);
    if (!match) break;
    const start = match.index, token = match[0], next = start + token.length;
    let end: number | undefined, kind: MarkupSpan["kind"] = "code";
    if (token.startsWith("http") || /^[A-Za-z]:\\/.test(token)) {
      end = start + (token.startsWith("http") ? URL : PATH).exec(text.slice(start))![0].length;
    } else if (token[0] === "`" || token[0] === "~") {
      const fence = token.length >= 3 && !text.slice(text.lastIndexOf("\n", start - 1) + 1, start).trim();
      if (token[0] === "~" && !fence) { position = next; continue; }
      const pattern = fence ? new RegExp("^[ \\t]{0,3}" + token[0] + "{" + token.length + ",}[ \\t]*(?:\\n|$)", "m")
        : new RegExp("(?<!`)" + token + "(?!`)");
      const closing = pattern.exec(text.slice(next));
      if (closing) end = next + closing.index + closing[0].length;
      else if (fence) end = text.length;
    } else if (["$", "$$", "\\(", "\\["].includes(token) && !escaped(text, start)) {
      end = mathEnd(text, start, token); kind = "math";
    }
    if (end === undefined) { position = next; continue; }
    if (plain < start) yield { kind: "prose", start: plain, end: start };
    yield { kind, start, end };
    plain = position = end;
  }
  if (plain < text.length) yield { kind: "prose", start: plain, end: text.length };
}

export function inlineMathLinewrap(token: string) {
  return token.startsWith("$") && !token.startsWith("$$") ? token.replace(/\n/g, " ") : token;
}
