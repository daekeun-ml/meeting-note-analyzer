// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ createLecture: vi.fn(), completeLectureUpload: vi.fn(), startLecture: vi.fn() }));
const upload = vi.hoisted(() => vi.fn());
vi.mock("../api", () => ({ useApi: () => api }));
vi.mock("../upload", () => ({ uploadMultipart: upload }));
import { LectureUploadForm } from "../../pages/LectureUploadPage";
let root: Root, element: HTMLDivElement, client: QueryClient;
beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  const target = { uploadId: "v", parts: [], partSize: 16, expiresAt: "2099-01-01" };
  api.createLecture.mockResolvedValue({ lecture: { lectureId: "lecture" }, uploads: { video: target } });
  api.completeLectureUpload.mockResolvedValue(undefined); api.startLecture.mockResolvedValue(undefined);
  upload.mockResolvedValue([{ partNumber: 1, etag: "part" }]);
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element); client = new QueryClient();
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter><LectureUploadForm /></MemoryRouter></QueryClientProvider>));
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); client.clear(); });
function fileInput(label: string) { return element.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement; }
async function choose(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
function submit() { return [...element.querySelectorAll("button")].find((b) => b.textContent === "학습 자료 만들기")!; }
it("accepts MP4 alone and does not send a slide completion request", async () => {
  expect(fileInput("강의 영상").accept).toBe("video/mp4,.mp4");
  expect(fileInput("강의 장표 (선택)").accept).toBe(".pptx,.pdf");
  await choose(fileInput("강의 영상"), new File(["mp4 fixture"], "course.mp4", { type: "video/mp4" }));
  expect(submit().disabled).toBe(false);
  await act(async () => submit().click());
  expect(api.createLecture.mock.calls[0]![0]).toMatchObject({ video: { fileName: "course.mp4", contentType: "video/mp4" } });
  expect(api.createLecture.mock.calls[0]![0].slides).toBeUndefined();
  expect(api.completeLectureUpload).toHaveBeenCalledOnce();
  expect(api.completeLectureUpload.mock.calls[0]![1].asset).toBe("video");
  expect(api.startLecture).toHaveBeenCalledWith("lecture");
});
it("does not accept an MP3 as the primary lecture video", async () => {
  await choose(fileInput("강의 영상"), new File(["audio"], "voice.mp3", { type: "audio/mpeg" }));
  expect(submit().disabled).toBe(true);
  expect(api.createLecture).not.toHaveBeenCalled();
});
