import { afterEach, expect, it, vi } from "vitest";
import { createApi } from "../api";

afterEach(() => vi.unstubAllGlobals());
const ok = () => new Response(JSON.stringify({ meeting: { meetingId: "m1" } }), { status: 200 });
const unauthorized = () => new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 });

it("renews the token once after a 401 and retries the request with the new one", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok());
  vi.stubGlobal("fetch", fetcher);
  const renew = vi.fn().mockResolvedValue("fresh-token");
  const result = await createApi("/api", () => "stale-token", renew).getMeeting("m1");
  expect(result.meeting.meetingId).toBe("m1");
  expect(renew).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![1].headers.authorization).toBe("Bearer stale-token");
  expect(fetcher.mock.calls[1]![1].headers.authorization).toBe("Bearer fresh-token");
});
it("surfaces the 401 when no new token can be obtained, and never retries twice", async () => {
  const fetcher = vi.fn().mockResolvedValue(unauthorized());
  vi.stubGlobal("fetch", fetcher);
  await expect(createApi("/api", () => "stale", vi.fn().mockResolvedValue(undefined)).getMeeting("m1")).rejects.toMatchObject({ status: 401 });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(createApi("/api", () => "stale", vi.fn().mockResolvedValue("fresh")).getMeeting("m1")).rejects.toMatchObject({ status: 401 });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("does not renew for other errors or when no renewal is wired", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 403 })).mockResolvedValueOnce(unauthorized());
  vi.stubGlobal("fetch", fetcher);
  const renew = vi.fn();
  await expect(createApi("/api", () => "t", renew).getMeeting("m1")).rejects.toMatchObject({ status: 403 });
  await expect(createApi("/api", () => "t").getMeeting("m1")).rejects.toMatchObject({ status: 401 });
  expect(renew).not.toHaveBeenCalled();
});
