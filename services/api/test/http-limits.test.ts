import { expect, it, vi } from "vitest";
import { z } from "zod";
import { MAX_API_BODY_BYTES, parseBody } from "../src/lib/http.js";
import { completeUploadSchema } from "../src/routes/meetings.js";
import { completeLectureUploadSchema, completeInterviewUploadSchema } from "@meeting-notes/shared";

it.each([false, true])("rejects oversized request bodies before validation (base64=%s)", (isBase64Encoded) => {
  const schema = z.unknown();
  const parse = vi.spyOn(schema, "safeParse");
  const text = JSON.stringify("x".repeat(MAX_API_BODY_BYTES));
  const body = isBase64Encoded ? Buffer.from(text).toString("base64") : text;
  expect(() => parseBody({ body, isBase64Encoded }, schema)).toThrow(expect.objectContaining({ status: 413 }));
  expect(parse).not.toHaveBeenCalled();
});

it("limits decoded bytes as well as encoded length and counts UTF-8 bytes", () => {
  const decoded = Buffer.alloc(MAX_API_BODY_BYTES + 1, " ");
  expect(() => parseBody({ body: decoded.toString("base64"), isBase64Encoded: true }, z.unknown()))
    .toThrow(expect.objectContaining({ status: 413 }));
  expect(() => parseBody({ body: JSON.stringify("한".repeat(MAX_API_BODY_BYTES / 2)), isBase64Encoded: false }, z.unknown()))
    .toThrow(expect.objectContaining({ status: 413 }));
});

it("rejects excessive collections before validating their contents", () => {
  const result = completeUploadSchema.safeParse({ uploadId: "u", parts: Array.from({ length: 10001 }, () => ({})) });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues).toHaveLength(1);
});

it("bounds error output for collections within the allowed length", () => {
  try {
    parseBody({ body: JSON.stringify({ uploadId: "u", parts: Array.from({ length: 10 }, () => ({})) }), isBase64Encoded: false }, completeUploadSchema);
    throw new Error("expected validation error");
  } catch (error) {
    expect(error).toMatchObject({ status: 400, code: "validation" });
    expect((error as Error).message.length).toBeLessThanOrEqual(1008);
    expect((error as Error).message.split("; ")).toHaveLength(5);
  }
});

it.each([
  { schema: completeUploadSchema, limit: 32, asset: undefined },
  { schema: completeInterviewUploadSchema, limit: 32, asset: "audio" },
  { schema: completeLectureUploadSchema, limit: 256, asset: "video" },
])("bounds multipart lists by supported upload sizes ($limit parts)", ({ schema, limit, asset }) => {
  const parts = Array.from({ length: limit }, (_, index) => ({ partNumber: index + 1, etag: "tag" }));
  expect(schema.safeParse({ uploadId: "u", asset, parts }).success).toBe(true);
  expect(schema.safeParse({ uploadId: "u", asset, parts: [...parts, {}] }).success).toBe(false);
});

it("preserves ordinary JSON, base64 and empty-body defaults", () => {
  const schema = z.object({ title: z.string().default("untitled") });
  expect(parseBody({ body: Buffer.from('{"title":"한글"}').toString("base64"), isBase64Encoded: true }, schema)).toEqual({ title: "한글" });
  expect(parseBody({ isBase64Encoded: false }, schema)).toEqual({ title: "untitled" });
  expect(() => parseBody({ body: "{", isBase64Encoded: false }, schema)).toThrow(expect.objectContaining({ status: 400 }));
});
