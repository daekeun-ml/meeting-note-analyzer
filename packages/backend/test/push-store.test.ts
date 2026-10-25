import { beforeEach, expect, it, vi } from "vitest";
import { meetingKeys } from "@meeting-notes/shared";
const m = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@aws-sdk/lib-dynamodb", async (original) => ({
  ...await original<typeof import("@aws-sdk/lib-dynamodb")>(),
  DynamoDBDocumentClient: { from: () => ({ send: m.send }) },
}));
vi.mock("../src/env.js", () => ({ env: { tableName: "test-table" } }));
import { deletePushSubscription, putPushSubscription, PushSubscriptionLimitError } from "../src/db.js";
const rec = { ...meetingKeys.push("owner", "hash"), owner: "owner", endpoint: "https://fcm.googleapis.com/token",
  keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) }, createdAt: "now" };
beforeEach(() => m.send.mockReset());

it("atomically reserves a slot and stores a subscription; allows refreshes at capacity", async () => {
  m.send.mockResolvedValueOnce({ Item: { endpoints: new Set(["PUSH#hash"]) } }).mockResolvedValueOnce({});
  await putPushSubscription(rec);
  const transaction = m.send.mock.calls[1]![0];
  expect(transaction.constructor.name).toBe("TransactWriteCommand");
  expect(transaction.input.TransactItems).toEqual([
    { Update: expect.objectContaining({
      Key: { PK: "USER#owner", SK: "PUSH_LIMIT" },
      ConditionExpression: expect.stringContaining("contains(endpoints, :endpoint)"),
      ExpressionAttributeValues: { ":endpointSet": new Set(["PUSH#hash"]), ":endpoint": "PUSH#hash", ":max": 20 },
    }) },
    { Put: { TableName: "test-table", Item: rec } },
  ]);
});

it("reports a full slot set without issuing an independent record write", async () => {
  m.send.mockResolvedValueOnce({ Item: {} }).mockRejectedValueOnce({
    name: "TransactionCanceledException", CancellationReasons: [{ Code: "ConditionalCheckFailed" }, { Code: "None" }],
  });
  await expect(putPushSubscription(rec)).rejects.toBeInstanceOf(PushSubscriptionLimitError);
  expect(m.send.mock.calls.map(([command]) => command.constructor.name)).toEqual(["GetCommand", "TransactWriteCommand"]);
});

it("adopts legacy slots once and tolerates another caller winning initialization", async () => {
  m.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Items: [{ SK: "PUSH#legacy" }] })
    .mockRejectedValueOnce({ name: "ConditionalCheckFailedException" }).mockResolvedValueOnce({});
  await putPushSubscription(rec);
  expect(m.send.mock.calls[1]![0].input).toMatchObject({ Limit: 20, ConsistentRead: true });
  expect(m.send.mock.calls[2]![0].input).toMatchObject({
    Item: { endpoints: new Set(["PUSH#legacy"]) }, ConditionExpression: "attribute_not_exists(PK)",
  });
  expect(m.send.mock.calls[3]![0].constructor.name).toBe("TransactWriteCommand");
});

it("releases the slot and deletes the record in one transaction", async () => {
  m.send.mockResolvedValueOnce({ Item: {} }).mockResolvedValueOnce({});
  await deletePushSubscription("owner", "hash");
  expect(m.send.mock.calls[1]![0].input.TransactItems).toEqual([
    { Delete: { TableName: "test-table", Key: meetingKeys.push("owner", "hash") } },
    { Update: expect.objectContaining({
      Key: { PK: "USER#owner", SK: "PUSH_LIMIT" }, UpdateExpression: "DELETE endpoints :endpointSet",
      ExpressionAttributeValues: { ":endpointSet": new Set(["PUSH#hash"]) },
    }) },
  ]);
});
