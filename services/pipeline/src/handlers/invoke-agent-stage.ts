import { randomUUID } from "node:crypto";
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import { SFNClient, SendTaskSuccessCommand } from "@aws-sdk/client-sfn";
import { getMeeting } from "@meeting-notes/backend";
import { STAGES, type Stage } from "@meeting-notes/shared";
import { pipelineEnv } from "../lib/env.js";
import { setStage } from "../lib/meeting-updates.js";
import { completedStageKey } from "../lib/resume.js";

const agentcore = new BedrockAgentCoreClient({});
const sfn = new SFNClient({});

export interface InvokeStageInput {
  taskToken: string;
  stage: Stage;
  meetingId: string;
  ownerSub: string;
  title: string;
  outputLanguage: string;
  transcriptKey: string;
  /** Step Functions execution name; all stages of one run share a runtime session so the console groups them per meeting. */
  executionName?: string;
  /** Retry of a FAILED meeting: stages that completed earlier are acknowledged without running the agent again. */
  resume?: boolean;
  documentKey?: string | null;
}

export class AgentInvokeError extends Error {
  override name = "AgentInvokeError";
}

export const handler = async (input: InvokeStageInput) => {
  if (!STAGES.includes(input.stage)) throw new AgentInvokeError(`unknown stage ${input.stage}`);
  if (input.resume) {
    const meeting = await getMeeting(input.meetingId);
    const done = meeting ? completedStageKey(meeting, input.stage) : null;
    if (done) {
      await sfn.send(new SendTaskSuccessCommand({ taskToken: input.taskToken, output: JSON.stringify({ stage: input.stage, s3Key: done, skipped: true }) }));
      return { skipped: true, s3Key: done };
    }
  }
  await setStage(input.meetingId, input.stage, "RUNNING");
  const sessionId = `mna-${input.meetingId}-${input.executionName ?? randomUUID()}`;
  const payload = {
    stage: input.stage,
    meetingId: input.meetingId,
    ownerSub: input.ownerSub,
    title: input.title,
    outputLanguage: input.outputLanguage,
    transcriptKey: input.transcriptKey,
    taskToken: input.taskToken,
    ...(input.stage === "meeting_brief" && input.documentKey ? { documentKey: input.documentKey } : {}),
  };
  const res = await agentcore.send(
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn: pipelineEnv.agentRuntimeArn,
      runtimeSessionId: sessionId,
      contentType: "application/json",
      accept: "application/json",
      payload: Buffer.from(JSON.stringify(payload), "utf8"),
    }),
  );
  const body = res.response ? await res.response.transformToString() : "";
  let parsed: { status?: string; error?: string } = {};
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    throw new AgentInvokeError(`agent runtime returned non-JSON: ${body.slice(0, 200)}`);
  }
  if (parsed.status !== "accepted") throw new AgentInvokeError(`agent runtime did not accept stage: ${body.slice(0, 500)}`);
  return { sessionId };
};
