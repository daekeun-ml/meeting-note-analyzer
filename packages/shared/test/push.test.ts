import { expect, it } from "vitest";
import { isAllowedPushEndpoint, pushSubscriptionSchema } from "../src/push.js";

it.each([
  "https://fcm.googleapis.com/fcm/send/token",
  "https://updates.push.services.mozilla.com/wpush/v2/token",
  "https://web.push.apple.com/token",
  "https://wns2-par02p.notify.windows.com/w/?token=value",
])("allows supported HTTPS push providers: %s", (endpoint) => {
  expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  expect(pushSubscriptionSchema.safeParse({ endpoint, keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } }).success).toBe(true);
});

it.each([
  "https://127.0.0.1/private", "https://169.254.169.254/", "https://[::1]/", "http://fcm.googleapis.com/push",
  "https://fcm.googleapis.com:8443/push", "https://fcm.googleapis.com.evil.invalid/push",
  "https://fcm.googleapis.com@evil.invalid/",
  "https://evil.invalid/notify.windows.com", "https://notify.windows.com.evil.invalid/",
  "https://web.push.apple.com/push#fragment", "file:///tmp/push", "https://example.org/",
])("rejects arbitrary hosts, alternate ports and confusing URLs: %s", (endpoint) => {
  expect(isAllowedPushEndpoint(endpoint)).toBe(false);
});

it("rejects userinfo on a trusted provider URL", () => {
  const url = new URL("https://fcm.googleapis.com/push");
  url.username = "synthetic-user";
  expect(isAllowedPushEndpoint(url.href)).toBe(false);
});

it("rejects missing or unbounded push encryption keys", () => {
  expect(pushSubscriptionSchema.safeParse({ endpoint: "https://fcm.googleapis.com/push", keys: { p256dh: "a".repeat(10000), auth: "a" } }).success).toBe(false);
});
