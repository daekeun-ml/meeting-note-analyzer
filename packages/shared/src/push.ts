import { z } from "zod";

export const PUSH_LIMITS = { subscriptions: 20, concurrency: 4, timeoutMs: 5000 } as const;

/** Only browser push providers may receive server-side notification requests. */
export function isAllowedPushEndpoint(value: string): boolean {
  if (value.length > 2048 || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return false;
    return ["fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(url.hostname)
      || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
  } catch { return false; }
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isAllowedPushEndpoint, "Unsupported push provider"),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}(==)?$/),
  }),
  userAgent: z.string().max(512).optional(),
});
