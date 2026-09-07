import { describe, expect, it } from "vitest";
import { buildMeetingRecord, completeUploadSchema, createMeetingSchema } from "../src/routes/meetings.js";

describe("createMeetingSchema", () => {
  it("accepts an mp3 within limits and defaults language to ko", () => {
    const parsed = createMeetingSchema.parse({ fileName: "standup.mp3", fileSize: 1024, contentType: "audio/mpeg" });
    expect(parsed.outputLanguage).toBe("ko");
  });
  it("rejects non-mp3 and oversize files", () => {
    expect(() => createMeetingSchema.parse({ fileName: "a.m4a", fileSize: 10, contentType: "audio/mp4" })).toThrow();
    expect(() => createMeetingSchema.parse({ fileName: "a.mp3", fileSize: 600 * 1024 * 1024, contentType: "audio/mpeg" })).toThrow();
  });
});

describe("buildMeetingRecord", () => {
  it("derives keys, title and GSI attributes from the caller", () => {
    const rec = buildMeetingRecord(
      { sub: "user-1", email: "u@example.com" },
      { fileName: "Weekly Sync.mp3", fileSize: 5, contentType: "audio/mpeg", outputLanguage: "en" },
      new Date("2026-09-05T00:00:00Z"),
    );
    expect(rec.PK).toBe(`MEETING#${rec.meetingId}`);
    expect(rec.GSI1PK).toBe("USER#user-1");
    expect(rec.GSI1SK).toBe("2026-09-05T00:00:00.000Z");
    expect(rec.title).toBe("Weekly Sync");
    expect(rec.audioKey).toBe(`uploads/user-1/${rec.meetingId}/audio.mp3`);
    expect(rec.status).toBe("UPLOAD_PENDING");
  });
});

describe("completeUploadSchema", () => {
  it("requires an upload id and at least one part with an etag", () => {
    expect(completeUploadSchema.parse({ uploadId: "u", parts: [{ partNumber: 1, etag: '"abc"' }] }).parts).toHaveLength(1);
    expect(() => completeUploadSchema.parse({ uploadId: "u", parts: [] })).toThrow();
    expect(() => completeUploadSchema.parse({ uploadId: "", parts: [{ partNumber: 0, etag: "x" }] })).toThrow();
  });
});
