import * as sns from "aws-cdk-lib/aws-sns";
import { LECTURE_INFERENCE_PREFIX } from "@meeting-notes/shared";

/** SageMaker notifications carry inferenceId in the JSON message body. */
export function sttNotificationFilter(kind: "meeting" | "lecture"): Record<string, sns.FilterOrPolicy> {
  return { inferenceId: sns.FilterOrPolicy.filter(new sns.SubscriptionFilter([
    kind === "lecture" ? { prefix: LECTURE_INFERENCE_PREFIX } : { "anything-but": { prefix: LECTURE_INFERENCE_PREFIX } },
  ])) };
}
