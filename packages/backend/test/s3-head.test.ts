import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../src/env.js", () => ({ env: { dataBucket: "test-bucket" } }));
import { headObject } from "../src/s3.js";

afterEach(() => vi.restoreAllMocks());
it("returns an object revision for transcript caching", async () => {
  const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ ETag: '"v1"' } as never);
  expect(await headObject("results/m1/transcript_attributed.json")).toEqual({ revision: '"v1"' });
  expect(send.mock.calls[0]![0]).toBeInstanceOf(HeadObjectCommand);
});
it("uses the ETag when S3 versioning is suspended", async () => {
  vi.spyOn(S3Client.prototype, "send").mockResolvedValue({ VersionId: "null", ETag: '"changed"' } as never);
  expect(await headObject("transcript")).toEqual({ revision: '"changed"' });
});
it.each([{ name: "NotFound" }, { name: "NoSuchKey" }, { $metadata: { httpStatusCode: 404 } }])("recognizes a missing object: %j", async (error) => {
  vi.spyOn(S3Client.prototype, "send").mockRejectedValue(error as never);
  expect(await headObject("missing")).toBeNull();
});
it.each([{ name: "AccessDenied" }, { $metadata: { httpStatusCode: 503 } }])("propagates operational failures: %j", async (error) => {
  vi.spyOn(S3Client.prototype, "send").mockRejectedValue(error as never);
  await expect(headObject("unavailable")).rejects.toBe(error);
});
