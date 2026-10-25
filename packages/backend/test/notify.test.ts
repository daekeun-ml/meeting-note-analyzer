import { beforeEach, expect, it, vi } from "vitest";
import { PUSH_LIMITS } from "@meeting-notes/shared";
const m = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn(), send: vi.fn(), secret: vi.fn() }));
vi.mock("../src/db.js", () => ({ listPushSubscriptions: m.list, deletePushSubscription: m.remove }));
vi.mock("../src/env.js", () => ({ env: { vapidSecretName: "test" } }));
vi.mock("web-push", () => ({ default: { sendNotification: m.send } }));
vi.mock("@aws-sdk/client-secrets-manager", async (original) => ({
  ...await original<typeof import("@aws-sdk/client-secrets-manager")>(),
  SecretsManagerClient: class { send = m.secret; },
}));
import { notifyUser } from "../src/notify.js";
const subscription = (id: number, endpoint = `https://fcm.googleapis.com/fcm/send/${id}`) => ({
  SK: `PUSH#${id}`, endpoint, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
});
beforeEach(() => {
  vi.clearAllMocks();
  m.secret.mockResolvedValue({ SecretString: JSON.stringify({ publicKey: "public", privateKey: "private", subject: "mailto:test@example.invalid" }) });
  m.remove.mockResolvedValue(undefined);
  m.send.mockResolvedValue({});
});

it("prunes unsafe legacy destinations without making an outbound request", async () => {
  m.list.mockResolvedValue([subscription(1, "https://127.0.0.1/"), subscription(2)]);
  expect(await notifyUser("owner", { title: "title", body: "body", url: "/" })).toEqual({ sent: 1, pruned: 1 });
  expect(m.send).toHaveBeenCalledTimes(1);
  expect(m.send.mock.calls[0]![0].endpoint).toBe("https://fcm.googleapis.com/fcm/send/2");
  expect(m.remove).toHaveBeenCalledWith("owner", "1");
});

it("caps fanout and concurrent requests and applies a per-request timeout", async () => {
  m.list.mockResolvedValue(Array.from({ length: 30 }, (_, id) => subscription(id)));
  let active = 0, maximum = 0;
  m.send.mockImplementation(async (_subscription, _payload, options) => {
    expect(options.timeout).toBe(PUSH_LIMITS.timeoutMs);
    active++; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
  });
  expect(await notifyUser("owner", { title: "", body: "", url: "/" })).toEqual({ sent: 20, pruned: 0 });
  expect(maximum).toBe(PUSH_LIMITS.concurrency);
  expect(m.send).toHaveBeenCalledTimes(PUSH_LIMITS.subscriptions);
});

it("continues after failed requests and removes expired subscriptions", async () => {
  m.list.mockResolvedValue([subscription(1), subscription(2), subscription(3)]);
  m.send.mockRejectedValueOnce({ statusCode: 410 }).mockRejectedValueOnce(new Error("timeout")).mockResolvedValueOnce({});
  expect(await notifyUser("owner", { title: "", body: "", url: "/" })).toEqual({ sent: 1, pruned: 1 });
  expect(m.remove).toHaveBeenCalledWith("owner", "1");
});
