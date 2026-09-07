import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sns from "aws-cdk-lib/aws-sns";
import { LambdaSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { it } from "vitest";
import { sttNotificationFilter } from "../lib/stt-notification-filter.js";

it("routes SageMaker JSON notifications to exactly the matching subscriber namespace", () => {
  const stack = new Stack(new App(), "FilterTest");
  const topic = new sns.Topic(stack, "Topic");
  for (const kind of ["meeting", "lecture"] as const) {
    const fn = new lambda.Function(stack, kind, { runtime: lambda.Runtime.NODEJS_22_X, handler: "index.handler", code: lambda.Code.fromInline("exports.handler=async()=>{}") });
    topic.addSubscription(new LambdaSubscription(fn, { filterPolicyWithMessageBody: sttNotificationFilter(kind) }));
  }
  const template = Template.fromStack(stack);
  template.hasResourceProperties("AWS::SNS::Subscription", { FilterPolicyScope: "MessageBody", FilterPolicy: { inferenceId: [{ prefix: "lecture-" }] } });
  template.hasResourceProperties("AWS::SNS::Subscription", { FilterPolicyScope: "MessageBody", FilterPolicy: { inferenceId: [{ "anything-but": { prefix: "lecture-" } }] } });
});
