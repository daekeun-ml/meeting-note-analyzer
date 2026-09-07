import { describe, expect, it } from "vitest";
import { parseUploadKey, s3Keys } from "../src/index.js";

describe("parseUploadKey", () => {
  it("round-trips the canonical upload key", () => {
    const key = s3Keys.upload("abc-123", "m-456");
    expect(parseUploadKey(key)).toEqual({ ownerSub: "abc-123", meetingId: "m-456" });
  });
  it("rejects other objects in the bucket", () => {
    expect(parseUploadKey("stt/output/x.out")).toBeNull();
    expect(parseUploadKey("uploads/a/b/other.mp3")).toBeNull();
    expect(parseUploadKey("uploads/a/audio.mp3")).toBeNull();
  });
});
