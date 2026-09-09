import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "../src/db.js";
import { DOCUMENT_LOCK_SECONDS, DocumentBusyError, withDocumentLock } from "../src/document-lock.js";
vi.mock("../src/env.js", () => ({ env: { tableName: "test" } }));

let locks: Map<string, { token: string; ttl: number }>;
const conditionalFailure = () => Object.assign(new Error("condition failed"), { name: "ConditionalCheckFailedException" });
beforeEach(() => {
  locks = new Map();
  vi.spyOn(ddb, "send").mockImplementation(async (command: any) => {
    const input = command.input;
    const key = (input.Item ?? input.Key).PK;
    if (command instanceof PutCommand) {
      const previous = locks.get(key);
      if (previous && previous.ttl >= input.ExpressionAttributeValues[":now"]) throw conditionalFailure();
      locks.set(key, input.Item);
    } else if (command instanceof DeleteCommand) {
      if (locks.get(key)?.token !== input.ExpressionAttributeValues[":token"]) throw conditionalFailure();
      locks.delete(key);
    }
    return {};
  });
});
afterEach(() => vi.restoreAllMocks());
it("allows one writer per meeting and permits a retry after release", async () => {
  let entered!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const release = new Promise<void>(resolve => { finish = resolve; });
  const first = withDocumentLock("m1", async () => { entered(); await release; return "first"; });
  await started;
  const second = vi.fn();
  await expect(withDocumentLock("m1", second)).rejects.toBeInstanceOf(DocumentBusyError);
  expect(second).not.toHaveBeenCalled();
  expect(await withDocumentLock("m2", async () => "independent")).toBe("independent");
  finish(); expect(await first).toBe("first");
  expect(await withDocumentLock("m1", async () => "retry")).toBe("retry");
});
it("releases the lock when publication fails", async () => {
  await expect(withDocumentLock("m1", async () => { throw new Error("storage unavailable"); })).rejects.toThrow("storage unavailable");
  expect(locks.size).toBe(0);
});
it("reclaims an expired lock without relying on asynchronous DynamoDB TTL deletion", async () => {
  locks.set("MEETING#m1", { token: "expired", ttl: 1 });
  expect(await withDocumentLock("m1", async () => "done")).toBe("done");
  expect(DOCUMENT_LOCK_SECONDS).toBeGreaterThan(5 * 60);
});
it("never releases a different holder's lock or masks a completed operation", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await withDocumentLock("m1", async () => { locks.set("MEETING#m1", { token: "another", ttl: 9999999999 }); return "saved"; })).toBe("saved");
  expect(locks.get("MEETING#m1")?.token).toBe("another");
});
it("propagates storage errors instead of reporting contention", async () => {
  vi.mocked(ddb.send).mockRejectedValueOnce(new Error("AccessDenied") as never);
  await expect(withDocumentLock("m1", async () => {})).rejects.toThrow("AccessDenied");
});
