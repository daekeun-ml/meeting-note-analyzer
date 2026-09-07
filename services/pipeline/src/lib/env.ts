import { requireEnv } from "@meeting-notes/backend";
export { env } from "@meeting-notes/backend";
export const pipelineEnv = {
  get sttEndpointName() { return requireEnv("STT_ENDPOINT_NAME"); },
  get sttMode() { return process.env["STT_MODE"] ?? "intended"; },
  get agentRuntimeArn() { return requireEnv("AGENT_RUNTIME_ARN"); },
  get memoryId() { return process.env["MEMORY_ID"] ?? ""; },
  get webOrigin() { return process.env["WEB_ORIGIN"] ?? ""; },
};
