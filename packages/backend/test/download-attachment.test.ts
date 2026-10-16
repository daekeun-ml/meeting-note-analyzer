import { expect, it, vi } from "vitest";
const sign = vi.hoisted(() => vi.fn(async () => "https://example.org/download"));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: sign }));
vi.mock("../src/env.js", () => ({ env: { dataBucket: "bucket" } }));
import { presignDownload } from "../src/s3.js";

it("encodes Unicode attachment names safely while leaving playback URLs unchanged", async () => {
  sign.mockClear();
  await presignDownload("audio.mp3", 3600, "수업\r\nO'Reilly🧠.mp3");
  const command = (sign.mock.calls[0] as unknown as [unknown, { input: { ResponseContentDisposition?: string } }])[1];
  const header = command.input.ResponseContentDisposition!;
  expect(header).toMatch(/^attachment; filename\*=UTF-8''/);
  expect(header).not.toMatch(/[\r\n]/);
  expect(header).toContain("%27");
  expect(decodeURIComponent(header.split("''")[1]!)).toBe("수업__O'Reilly🧠.mp3");
  await presignDownload("audio.mp3");
  const playback = (sign.mock.calls[1] as unknown as [unknown, { input: { ResponseContentDisposition?: string } }])[1];
  expect(playback.input.ResponseContentDisposition).toBeUndefined();
});
