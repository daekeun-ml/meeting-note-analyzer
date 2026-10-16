/** Repair old generated prose while preserving Korean, code, and LaTeX commands. */
const CODE_SOURCE = "```[\\s\\S]*?```|`[^`\\n]*`";
export const MATH_SOURCE = String.raw`\$\$[\s\S]+?\$\$|(?<!\\)\$(?:\\.|[^$\\\n])+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]`;
export const LECTURE_TOKEN_SOURCE = `${CODE_SOURCE}|${MATH_SOURCE}`;
const COMMANDS = "arg|max|min|sum|prod|int|lim|log|ln|exp|frac|dfrac|tfrac|sqrt|alpha|beta|gamma|delta|theta|lambda|mu|nu|sigma|phi|omega|eta|nabla|partial|cdots|ldots|times|cdot|left|right|begin|end|text|mathrm|mathbf|mathbb";
const DOUBLE_COMMAND = new RegExp(String.raw`(?<!\\)\\\\(?=(?:${COMMANDS})(?![A-Za-z])|[()[\]])`, "g");
const BARE_MATH = /(?<!\\)\\(?:arg|frac|sum|prod|int|lim|sqrt)(?![A-Za-z])[A-Za-z0-9\\{}()[\]^_=+*/|<>,.:;!?\- \t]*?(?=[가-힣])/g;

function prose(text: string): string {
  return text.replace(/(?<!\\)(?:\\r\\n|\\n){2,}/g, "\n\n")
    .replace(/(?<!\\)(?:\\r\\n|\\n)(?![A-Za-z])/g, "\n")
    .replace(/(?<!\\)\\"/g, '"')
    .replace(BARE_MATH, (raw) => {
      const expression = raw.replace(/[ .,;:!?\t]+$/, "");
      return `$${expression}$${raw.slice(expression.length)}`;
    });
}

export function normalizeLectureText(text: string): string {
  return text.replace(/\r\n/g, "\n").split(new RegExp(`(${CODE_SOURCE})`, "g")).map((part, i) => {
    if (i % 2) return part;
    const value = part.replace(DOUBLE_COMMAND, "\\");
    const out: string[] = []; let end = 0;
    for (const match of value.matchAll(new RegExp(MATH_SOURCE, "g"))) {
      out.push(prose(value.slice(end, match.index)), match[0]);
      end = match.index + match[0].length;
    }
    out.push(prose(value.slice(end)));
    return out.join("");
  }).join("");
}

export function lectureParagraphs(text: string): string[] {
  const value = normalizeLectureText(text);
  const protectedRanges = [...value.matchAll(new RegExp(LECTURE_TOKEN_SOURCE, "g"))].map((m) => [m.index, m.index + m[0].length]);
  const blocks: string[] = []; let start = 0;
  for (const match of value.matchAll(/\n{2,}/g)) {
    if (protectedRanges.some(([a, b]) => a! <= match.index && match.index < b!)) continue;
    blocks.push(value.slice(start, match.index));
    start = match.index + match[0].length;
  }
  blocks.push(value.slice(start));
  return blocks.filter((block) => block.trim());
}
