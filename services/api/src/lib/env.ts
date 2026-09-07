export { env } from "@meeting-notes/backend";
export const apiEnv = {
  get stateMachineArn() { return process.env["STATE_MACHINE_ARN"] ?? ""; },
  get memoryId() { return process.env["MEMORY_ID"] ?? ""; },
  get chatMemoryId() { return process.env["CHAT_MEMORY_ID"] ?? ""; },
};
