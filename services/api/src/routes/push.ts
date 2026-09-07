import { z } from "zod";
import type { PushSubscriptionRecord } from "@meeting-notes/shared";
import { meetingKeys } from "@meeting-notes/shared";
import { deletePushSubscription, putPushSubscription } from "@meeting-notes/backend";
import type { Caller } from "../lib/http.js";
import { endpointHash } from "./meetings.js";

export const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().max(512).optional(),
});

export async function subscribe(caller: Caller, input: z.infer<typeof subscriptionSchema>): Promise<void> {
  const rec: PushSubscriptionRecord = {
    ...meetingKeys.push(caller.sub, endpointHash(input.endpoint)),
    owner: caller.sub,
    endpoint: input.endpoint,
    keys: input.keys,
    userAgent: input.userAgent,
    createdAt: new Date().toISOString(),
  };
  await putPushSubscription(rec);
}

export const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) });

export async function unsubscribe(caller: Caller, input: z.infer<typeof unsubscribeSchema>): Promise<void> {
  await deletePushSubscription(caller.sub, endpointHash(input.endpoint));
}
