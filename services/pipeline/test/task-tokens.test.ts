import { beforeEach, expect, it, vi } from "vitest";
const send = vi.hoisted(() => vi.fn());
vi.mock("@meeting-notes/backend", () => ({ ddb: { send }, env: { tableName: "tokens" } }));
import { deleteTaskToken, getTaskToken } from "../src/lib/task-tokens.js";
beforeEach(() => { send.mockReset(); });
it("reads callbacks consistently without deleting them", async () => {
  send.mockResolvedValue({ Item: { taskToken: "token" } });
  expect(await getTaskToken("id")).toMatchObject({ taskToken: "token" });
  expect(send).toHaveBeenCalledOnce(); expect(send.mock.calls[0]![0].input.ConsistentRead).toBe(true);
});
it("does not delete a replacement token when an old callback finishes", async () => {
  send.mockRejectedValue(Object.assign(new Error(), { name: "ConditionalCheckFailedException" }));
  await expect(deleteTaskToken("id", "old-token")).resolves.toBeUndefined();
  expect(send.mock.calls[0]![0].input).toMatchObject({ ConditionExpression: "taskToken = :token", ExpressionAttributeValues: { ":token": "old-token" } });
});
