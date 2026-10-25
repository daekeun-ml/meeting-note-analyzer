import { z } from "zod";
import type { PushSubscriptionRecord } from "@meeting-notes/shared";
import { meetingKeys, pushSubscriptionSchema } from "@meeting-notes/shared";
import { deletePushSubscription, putPushSubscription, PushSubscriptionLimitError } from "@meeting-notes/backend";
import { HttpError, type Caller } from "../lib/http.js";
import { endpointHash } from "./meetings.js";

export const subscriptionSchema = pushSubscriptionSchema;

export async function subscribe(caller: Caller, input: z.infer<typeof subscriptionSchema>): Promise<void> {
  const rec: PushSubscriptionRecord = {
    ...meetingKeys.push(caller.sub, endpointHash(input.endpoint)),
    owner: caller.sub,
    endpoint: input.endpoint,
    keys: input.keys,
    userAgent: input.userAgent,
    createdAt: new Date().toISOString(),
  };
  try { await putPushSubscription(rec); }
  catch (error) {
    if (error instanceof PushSubscriptionLimitError) throw new HttpError(429, "알림 기기 등록 한도를 초과했습니다", "subscription_limit");
    throw error;
  }
}

export const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) });

export async function unsubscribe(caller: Caller, input: z.infer<typeof unsubscribeSchema>): Promise<void> {
  await deletePushSubscription(caller.sub, endpointHash(input.endpoint));
}
