import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import webpush from "web-push";
import { deletePushSubscription, listPushSubscriptions } from "./db.js";
import { env } from "./env.js";

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
  const subs = await listPushSubscriptions(ownerSub);
  if (subs.length === 0) return { sent: 0, pruned: 0 };
  const keys = await loadVapid();
  let sent = 0;
  let pruned = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload),
          { vapidDetails: keys, TTL: 24 * 3600, urgency: "high" },
        );
        sent += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await deletePushSubscription(ownerSub, sub.SK.replace(/^PUSH#/, ""));
          pruned += 1;
        } else {
          console.warn("push failed", { endpoint: sub.endpoint.slice(0, 40), status, err: String(err) });
        }
      }
    }),
  );
  return { sent, pruned };
}
