import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import webpush from "web-push";
import { deletePushSubscription, listPushSubscriptions } from "./db.js";
import { env } from "./env.js";
import { PUSH_LIMITS, pushSubscriptionSchema } from "@meeting-notes/shared";

const sm = new SecretsManagerClient({});
export interface VapidKeys { publicKey: string; privateKey: string; subject: string }
let vapid: VapidKeys | undefined;

export async function loadVapid(): Promise<VapidKeys> {
  if (vapid) return vapid;
  const res = await sm.send(new GetSecretValueCommand({ SecretId: env.vapidSecretName }));
  const parsed = JSON.parse(res.SecretString ?? "{}") as Partial<VapidKeys>;
  if (!parsed?.publicKey || !parsed.privateKey || !parsed.subject) throw new Error("VAPID secret incomplete");
  vapid = { publicKey: parsed.publicKey, privateKey: parsed.privateKey, subject: parsed.subject };
  return vapid;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/** Sends to every subscription of the user; prunes subscriptions the push service reports gone (404/410). */
export async function notifyUser(ownerSub: string, payload: PushPayload): Promise<{ sent: number; pruned: number }> {
  const subs = (await listPushSubscriptions(ownerSub)).slice(0, PUSH_LIMITS.subscriptions);
  if (subs.length === 0) return { sent: 0, pruned: 0 };
  const keys = await loadVapid();
  let sent = 0;
  let pruned = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(PUSH_LIMITS.concurrency, subs.length) }, async () => {
      while (next < subs.length) {
        const sub = subs[next++]!;
        try {
          // Revalidate stored records too; old or tampered endpoints must never be requested.
          const subscription = pushSubscriptionSchema.safeParse(sub);
          if (!subscription.success) {
            await deletePushSubscription(ownerSub, sub.SK.replace(/^PUSH#/, ""));
            pruned += 1;
            continue;
          }
          await webpush.sendNotification(
            { endpoint: subscription.data.endpoint, keys: subscription.data.keys },
            JSON.stringify(payload),
            { vapidDetails: keys, TTL: 24 * 3600, urgency: "high", timeout: PUSH_LIMITS.timeoutMs },
          );
          sent += 1;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await deletePushSubscription(ownerSub, sub.SK.replace(/^PUSH#/, ""));
            pruned += 1;
          } else {
            console.warn("push failed", { status });
          }
        }
      }
    }),
  );
  return { sent, pruned };
}
