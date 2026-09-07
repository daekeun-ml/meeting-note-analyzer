import { afterEach, expect, it, vi } from "vitest";
import { createApi } from "../api";

afterEach(() => vi.unstubAllGlobals());
it("downloads large lecture documents directly without forwarding the user token to S3", async () => {
  const document = { version: 1, lectureId: "test", pages: Array.from({ length: 120 }, (_, i) => ({ page: i + 1, explanation: "Study notes" })) };
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ lecture: { lectureId: "test" }, documentUrl: "https://bucket.s3.amazonaws.com/document.json?signature=test", pageImages: [] })))
    .mockResolvedValueOnce(new Response(JSON.stringify(document)));
  vi.stubGlobal("fetch", fetcher);
  const result = await createApi("/api", () => "user-token").lectureResult("test");
  expect(result.document).toEqual(document);
  expect(fetcher.mock.calls[0]![1].headers.authorization).toBe("Bearer user-token");
  expect(fetcher.mock.calls[1]).toEqual(["https://bucket.s3.amazonaws.com/document.json?signature=test"]);
});
it("surfaces an expired or failed document download", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ documentUrl: "https://example.org/expired" }))).mockResolvedValueOnce(new Response("expired", { status: 403 })));
  await expect(createApi("/api", () => "token").lectureResult("test")).rejects.toMatchObject({ code: "document_download", status: 403 });
});
