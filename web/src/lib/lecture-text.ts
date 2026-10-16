/** Repair old generated prose while preserving Korean, code, and LaTeX commands. */
const CODE_SOURCE = "```[\\s\\S]*?```|`[^`\\n]*`|https?://[^\\s<>()]+";
export const MATH_SOURCE = String.raw`\$\$[\s\S]+?\$\$|(?<!\\)\$(?:\\.|[^$\\\n])+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]`;
export const LECTURE_TOKEN_SOURCE = `${CODE_SOURCE}|${MATH_SOURCE}`;
const COMMANDS = "arg|max|min|sum|prod|int|lim|log|ln|exp|frac|dfrac|tfrac|sqrt|alpha|beta|gamma|delta|theta|lambda|mu|nu|sigma|phi|omega|eta|nabla|partial|cdots|ldots|times|cdot|left|right|begin|end|text|mathrm|mathbf|mathbb";
const DOUBLE_COMMAND = new RegExp(String.raw`(?<!\\)\\\\(?=(?:${COMMANDS})(?![A-Za-z])|[()[\]])`, "g");
const BARE_MATH = /(?<!\\)\\(?:arg|frac|sum|prod|int|lim|sqrt)(?![A-Za-z])[A-Za-z0-9\\{}()[\]^_=+*/|<>,.:;!?\- \t]*?(?=[가-힣])/g;

function prose(text: string): string {
  const value = text.replace(/(?<!\\)(?:\\r\\n|\\n){2,}/g, "\n\n")
    .replace(/(?<!\\)(?:\\r\\n|\\n)(?![A-Za-z])/g, "\n")
    .replace(/(?<!\\)\\"/g, '"')
    .replace(BARE_MATH, (raw) => {
      const expression = raw.replace(/[ .,;:!?\t]+$/, "");
      return `$${expression}$${raw.slice(expression.length)}`;
    });
  const convert = (part: string) => part.replace(LEGACY_EXPRESSION, (raw) => {
      if (!/[α-ωΑ-Ω_^]/u.test(raw) && !/^[a-z]\/[A-Za-z]$/.test(raw)) return raw;
      return `$${legacyLatex(raw)}$`;
    });
  const out: string[] = []; let end = 0;
  for (const match of value.matchAll(new RegExp(MATH_SOURCE, "g"))) {
    out.push(convert(value.slice(end, match.index)), match[0]); end = match.index + match[0].length;
  }
  return out.join("") + convert(value.slice(end));
}

const GREEK: Record<string, string> = { α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", η: "eta", θ: "theta", λ: "lambda", μ: "mu", ν: "nu", π: "pi", ρ: "rho", σ: "sigma", τ: "tau", φ: "phi", ψ: "psi", ω: "omega", Γ: "Gamma", Δ: "Delta", Θ: "Theta", Λ: "Lambda", Σ: "Sigma", Φ: "Phi", Ψ: "Psi", Ω: "Omega" };
const ATOM = String.raw`(?:\d+(?:\.\d+)?|[A-Za-zα-ωΑ-Ω](?:[_^](?:\{[^{}\n]+\}|[A-Za-z0-9]+))*)`;
const LEGACY_EXPRESSION = new RegExp(String.raw`(?<![A-Za-z0-9_./:\\])${ATOM}(?:[+\-*/=]${ATOM})*(?![A-Za-z0-9_])`, "gu");
function legacyLatex(text: string): string {
  return text.replace(/[α-ωΑ-Ω]/gu, (letter) => GREEK[letter] ? `\\${GREEK[letter]} ` : letter)
    .replace(/([_^])([A-Za-z0-9]+)/g, (_, op: string, value: string) => `${op}{${op === "_" && /^[A-Za-z]{2,}$/.test(value) ? `\\mathrm{${value}}` : value}}`).trim();
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

/** CommonMark escapes backslash delimiters, so convert complete math tokens first. */
export function lectureMarkdown(text: string): string {
  return normalizeLectureText(text).replace(new RegExp(LECTURE_TOKEN_SOURCE, "g"), (raw) => {
    if (!raw.startsWith("\\")) return raw;
    return raw.startsWith("\\[") ? `$$${raw.slice(2, -2)}$$` : `$${raw.slice(2, -2)}$`;
  });
}
