// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FilePicker } from "../../components/FilePicker";

let element: HTMLDivElement, root: Root;
const onFile = vi.fn(), onError = vi.fn();
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onFile.mockReset(); onError.mockReset();
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });
async function render(disabled = false) {
  await act(async () => root.render(<FilePicker label="파일" accept=".mp3" file={null} disabled={disabled} hint="MP3" onFile={onFile} onError={onError} />));
}
async function drag(type: string, files: File[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files, types: ["Files"], items: [] } });
  await act(async () => element.querySelector('[role="group"]')!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
}
it("accepts one dropped file through the same callback as clicking and highlights the target", async () => {
  await render();
  const file = new File(["recording"], "class.mp3");
  await drag("dragenter", [file]);
  expect(element.querySelector('[data-drag-active="true"]')).not.toBeNull();
  await drag("drop", [file]);
  expect(onFile).toHaveBeenCalledWith(file);
  expect(element.querySelector('[data-drag-active="true"]')).toBeNull();
});
it("rejects multiple files and ignores drops while a resumable upload is locked", async () => {
  await render();
  const files = [new File(["a"], "a.mp3"), new File(["b"], "b.mp3")];
  await drag("drop", files);
  expect(onError).toHaveBeenCalledWith("이 영역에는 파일을 하나씩 놓아 주세요.");
  expect(onFile).not.toHaveBeenCalled();
  await render(true);
  await drag("drop", [files[0]!]);
  expect(onFile).not.toHaveBeenCalled();
});
