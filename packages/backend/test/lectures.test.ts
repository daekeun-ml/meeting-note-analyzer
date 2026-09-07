import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../src/db.js", () => ({ ddb: { send: mocks.send } }));
vi.mock("../src/env.js", () => ({ requireEnv: () => "lectures", env: { dataBucket: "data" } }));
import { LectureLimitError, claimLectureSlot, releaseLectureSlot } from "../src/lectures.js";

const cancelled = (...codes: string[]) => Object.assign(new Error("cancelled"), { name: "TransactionCanceledException", CancellationReasons: codes.map((Code) => ({ Code })) });
const write = { Update: { TableName: "lectures", Key: { PK: "MEETING#l1", SK: "META" }, UpdateExpression: "SET #s = :s", ConditionExpression: "#s = :old" } };
const commandName = (call: unknown[]) => (call[0] as { constructor: { name: string } }).constructor.name;
const input = (call: unknown[]) => (call[0] as { input: Record<string, unknown> }).input;
beforeEach(() => vi.resetAllMocks());

describe("claimLectureSlot", () => {
  it("claims a processing slot and the caller's write in one transaction", async () => {
    mocks.send.mockResolvedValue({});
    await claimLectureSlot("alice", 3, write);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(commandName(mocks.send.mock.calls[0]!)).toBe("TransactWriteCommand");
    const items = input(mocks.send.mock.calls[0]!)["TransactItems"] as { Update: Record<string, unknown> }[];
    expect(items).toHaveLength(2);
    expect(items[0]!.Update).toMatchObject({ TableName: "lectures", Key: { PK: "USER#alice", SK: "ACTIVE" } });
    expect(String(items[0]!.Update["ConditionExpression"])).toContain("< :max");
    expect(items[1]).toBe(write);
  });
  it("refuses a fourth active lecture", async () => {
    mocks.send.mockRejectedValueOnce(cancelled("ConditionalCheckFailed", "None"));
    mocks.send.mockResolvedValueOnce({ Items: [{ status: "ANALYZING" }, { status: "UPLOADED" }, { status: "UPLOAD_PENDING" }, { status: "COMPLETED" }] }); // recount
    await expect(claimLectureSlot("alice", 3, write)).rejects.toBeInstanceOf(LectureLimitError);
    expect(mocks.send.mock.calls.filter((c) => commandName(c) === "TransactWriteCommand")).toHaveLength(1);
  });
  it("heals a drifted counter from the real active count and retries once", async () => {
    mocks.send.mockRejectedValueOnce(cancelled("ConditionalCheckFailed", "None"));
    mocks.send.mockResolvedValueOnce({ Items: [{ status: "ANALYZING" }, { status: "FAILED" }] }); // recount: one active
    mocks.send.mockResolvedValueOnce({}); // counter reset
    mocks.send.mockResolvedValueOnce({}); // retried transaction
    await claimLectureSlot("alice", 3, write);
    const names = mocks.send.mock.calls.map(commandName);
    expect(names).toEqual(["TransactWriteCommand", "QueryCommand", "UpdateCommand", "TransactWriteCommand"]);
    expect(input(mocks.send.mock.calls[2]!)).toMatchObject({ Key: { PK: "USER#alice", SK: "ACTIVE" }, ExpressionAttributeValues: expect.objectContaining({ ":n": 1 }) });
  });
  it("surfaces the caller's own failed condition as a conditional check failure", async () => {
    mocks.send.mockRejectedValueOnce(cancelled("None", "ConditionalCheckFailed"));
    await expect(claimLectureSlot("alice", 3, write)).rejects.toMatchObject({ name: "ConditionalCheckFailedException" });
  });
});

describe("releaseLectureSlot", () => {
  it("decrements but never below zero", async () => {
    mocks.send.mockResolvedValueOnce({});
    await releaseLectureSlot("alice");
    expect(String(input(mocks.send.mock.calls[0]!)["ConditionExpression"])).toContain("> :zero");
    mocks.send.mockRejectedValueOnce(Object.assign(new Error("cond"), { name: "ConditionalCheckFailedException" }));
    await expect(releaseLectureSlot("alice")).resolves.toBeUndefined();
  });
});
