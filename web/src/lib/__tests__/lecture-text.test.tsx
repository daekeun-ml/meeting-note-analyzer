// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { LectureText, MathText } from "../../components/MathText";
import { normalizeLectureText } from "../lecture-text";

let element: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });

it("repairs the reported Korean overview into readable paragraphs and a rendered objective", async () => {
  const text = String.raw`본 강의는 \"Language Model\" 섹션을 다룹니다.\n\n자기회귀적 다음 단어 예측을 수식 \\arg\\max_\\theta \\sum_t \\log P(w^t|w^1,\\cdots,w^{t-1},\\theta)으로 제시합니다.\n\n단어 임베딩의 한계를 설명합니다.`;
  await act(async () => root.render(<LectureText text={text} />));
  expect(element.querySelectorAll("p")).toHaveLength(3);
  expect(element.querySelector("p")?.textContent).toBe('본 강의는 "Language Model" 섹션을 다룹니다.');
  expect(element.querySelectorAll(".katex")).toHaveLength(1);
  expect(element.querySelector(".katex-error")).toBeNull();
  expect(element.textContent).not.toContain(String.raw`\n`);
  expect(element.textContent).not.toContain(String.raw`\\arg`);
  expect(normalizeLectureText(normalizeLectureText(text))).toBe(normalizeLectureText(text));
});

it("supports both math delimiters, keeps matrices intact, and does not split inside display math", async () => {
  const text = String.raw`기울기는 \(\nabla f(x)\)이고 $\nu \neq 0$입니다.

\[
\begin{matrix}a & b \\ c & d\end{matrix}

\]

계산이 끝났습니다.`;
  await act(async () => root.render(<LectureText text={text} />));
  expect(element.querySelectorAll("p")).toHaveLength(2); // Display math is a separate block, not a prose paragraph.
  expect(element.querySelectorAll(".katex")).toHaveLength(3);
  expect(element.querySelectorAll(".katex-display")).toHaveLength(1);
  expect(element.querySelector(".katex-error")).toBeNull();
  expect(normalizeLectureText(text)).toBe(text);
});

it("preserves code and ambiguous English backslashes without executing generated HTML", async () => {
  const text = String.raw`코드: ` + "`print('\\n\\n')`, `$x$`, `\\\\theta`" +
    String.raw` 경로 C:\new\notes <img src=x onerror=alert(1)> $\href{javascript:alert(1)}{x}$`;
  await act(async () => root.render(<MathText text={text} />));
  expect([...element.querySelectorAll("code")].map((node) => node.textContent)).toEqual(["print('\\n\\n')", "$x$", "\\\\theta"]);
  expect(element.textContent).toContain(String.raw`C:\new\notes`);
  expect(element.querySelectorAll(".katex")).toHaveLength(1);
  expect(element.querySelector("img, script, a")).toBeNull();
});

it("renders the reported Markdown lists and unmarked learning-rate notation as math", async () => {
  const text = `세 섹션은 **Learning Rates → Normalization → Generalization**입니다.

**1) Learning Rates (p.16~21)**
- 학습률 η가 작으면 느리고, η_opt는 곡률에 맞춰 정합니다.
- 누적값 v^t와 진행도 t/T를 사용합니다.
- 편향 보정의 분모는 1-α^t입니다.`;
  await act(async () => root.render(<LectureText text={text} />));
  expect(element.querySelectorAll("strong")).toHaveLength(2);
  expect(element.querySelectorAll("ul > li")).toHaveLength(3);
  expect(element.querySelectorAll(".katex")).toHaveLength(5);
  expect(element.querySelector(".katex-error")).toBeNull();
  expect(element.textContent).not.toContain("**");
  expect(element.textContent).not.toContain("η_opt");
  expect(normalizeLectureText("module_name, file_id, https://example.org/v_t")).toBe("module_name, file_id, https://example.org/v_t");
});

it("renders currency, backticks inside math and wrapped inline equations without corrupting them", async () => {
  const text = "비용은 $20 또는 $30이며 학습률은 $\\eta$입니다.\n\n" +
    "단어는 $\\text{`bank`}$로 표시합니다.\n\n" +
    "수식 $\\alpha +\n\\beta$를 사용합니다.";
  await act(async () => root.render(<LectureText text={text} />));
  expect(element.textContent).toContain("$20");
  expect(element.textContent).toContain("$30");
  expect(element.querySelectorAll(".katex")).toHaveLength(3);
  expect(element.querySelector(".katex-error")).toBeNull();
  expect(normalizeLectureText(normalizeLectureText(text))).toBe(normalizeLectureText(text));
});

it("preserves multi-backtick and tilde code fences and Windows paths", async () => {
  const text = "````python\ntext = '``` $x'\n\\nabla f(x)\n````\n\n" +
    "~~~python\nprint('$x')\n\\nabla f(x)\n~~~\n\n" +
    "코드 ``print(`x`, '\\nabla')``와 경로 C:\\text\\notes, 수식 $\\alpha$입니다.";
  expect(normalizeLectureText(text)).toBe(text);
  await act(async () => root.render(<LectureText text={text} />));
  expect(element.querySelectorAll("pre")).toHaveLength(2);
  expect(element.querySelectorAll(".katex")).toHaveLength(1);
  expect(element.querySelector(".katex-error")).toBeNull();
  expect(element.textContent).toContain("C:\\text\\notes");
});
