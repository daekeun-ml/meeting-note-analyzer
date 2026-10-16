import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import * as ddb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import { expect, it } from "vitest";
import { loadConfig } from "../lib/config.js";
import { LectureStack } from "../lib/lecture-stack.js";

it("deploys Opus lecture reasoning and Sonnet extraction with access to both profiles", () => {
  const app = new App({ context: { opusModel: "global.anthropic.custom-opus", sonnetModel: "global.anthropic.custom-sonnet" } });
  const env = { account: "000000000000", region: "us-east-1" };
  const resources = new Stack(app, "LectureModelResources", { env });
  const dataBucket = new s3.Bucket(resources, "Data");
  const table = new ddb.Table(resources, "Table", { partitionKey: { name: "PK", type: ddb.AttributeType.STRING } });
  const topic = new sns.Topic(resources, "Topic");
  const errorTopic = new sns.Topic(resources, "ErrorTopic");
  const stack = new LectureStack(app, "LectureModels", {
    env, config: loadConfig(app), dataBucket, table, sttEndpointName: "test",
    sttEndpointArn: "arn:aws:sagemaker:us-east-1:000000000000:endpoint/test",
    sttSuccessTopic: topic, sttErrorTopic: errorTopic, alarmTopic: topic,
  });
  const template = Template.fromStack(stack);
  template.hasResourceProperties("AWS::BedrockAgentCore::Runtime", {
    EnvironmentVariables: { LECTURE_MODEL: "global.anthropic.custom-opus", LECTURE_FAST_MODEL: "global.anthropic.custom-sonnet", INTERVIEW_MODEL: "global.anthropic.custom-opus" },
  });
  const policies = JSON.stringify(template.findResources("AWS::IAM::Policy"));
  expect(policies).toContain("foundation-model/anthropic.custom-opus");
  expect(policies).toContain("foundation-model/anthropic.custom-sonnet");
});
