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
  expect(element.querySelectorAll("p")).toHaveLength(3);
  expect(element.querySelectorAll(".katex")).toHaveLength(3);
  expect(element.querySelectorAll(".katex-display")).toHaveLength(1);
  expect(element.querySelector(".katex-error")).toBeNull();
  expect(normalizeLectureText(text)).toBe(text);
});

it("preserves code and ambiguous English backslashes without executing generated HTML", async () => {
  const text = String.raw`코드: ` + "`print('\\n\\n')`, `$x$`, `\\\\theta`" +
    String.raw` 경로 C:\new\notes <img src=x onerror=alert(1)> $\href{javascript:alert(1)}{x}$`;
  await act(async () => root.render(<MathText text={text} />));
  expect(element.textContent).toContain("`print('\\n\\n')`, `$x$`, `\\\\theta`");
  expect(element.textContent).toContain(String.raw`C:\new\notes`);
  expect(element.querySelectorAll(".katex")).toHaveLength(1);
  expect(element.querySelector("img, script, a")).toBeNull();
});
