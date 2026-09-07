import { describe, expect, it } from "vitest";
import { planParts, rewriteUploadUrl } from "../src/upload.js";

describe("planParts", () => {
  it("splits into fixed parts with a short tail", () => {
    expect(planParts(35, 16)).toEqual([
      { partNumber: 1, start: 0, end: 16 },
      { partNumber: 2, start: 16, end: 32 },
      { partNumber: 3, start: 32, end: 35 },
    ]);
  });
  it("always yields one part for small files", () => {
    expect(planParts(5, 16)).toEqual([{ partNumber: 1, start: 0, end: 5 }]);
  });
});

describe("rewriteUploadUrl", () => {
  it("keeps path and query but swaps the host", () => {
    const u = "https://b.s3.us-east-1.amazonaws.com/uploads/u/m/audio.mp3?X-Amz-Signature=abc&partNumber=1";
    expect(rewriteUploadUrl(u, "https://app.example.com/")).toBe("https://app.example.com/uploads/u/m/audio.mp3?X-Amz-Signature=abc&partNumber=1");
    expect(rewriteUploadUrl(u, undefined)).toBe(u);
  });
});
