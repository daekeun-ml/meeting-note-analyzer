import { randomUUID } from "node:crypto";
import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./db.js";
import { env } from "./env.js";

// Longer than every writer's Lambda timeout (API: 29 seconds, Finalize: 5 minutes).
// A timed-out writer has stopped before another invocation can reclaim its lock.
export const DOCUMENT_LOCK_SECONDS = 10 * 60;

export class DocumentBusyError extends Error {
  override readonly name = "DocumentBusyError";
  constructor() { super("다른 변경사항을 저장 중입니다. 잠시 후 다시 시도해 주세요."); }
}

/** Serialize the complete read/modify/publish operation, including its DynamoDB metadata update. */
export async function withDocumentLock<T>(meetingId: string, operation: () => Promise<T>): Promise<T> {
  const key = { PK: `MEETING#${meetingId}`, SK: "DOCUMENT_LOCK" };
  const token = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  try {
    await ddb.send(new PutCommand({
      TableName: env.tableName, Item: { ...key, token, ttl: now + DOCUMENT_LOCK_SECONDS },
      ConditionExpression: "attribute_not_exists(PK) OR #ttl < :now",
      ExpressionAttributeNames: { "#ttl": "ttl" }, ExpressionAttributeValues: { ":now": now },
    }));
  } catch (error) {
    if ((error as { name?: string }).name === "ConditionalCheckFailedException") throw new DocumentBusyError();
    throw error;
  }
  try {
    return await operation();
  } finally {
    try {
      await ddb.send(new DeleteCommand({ TableName: env.tableName, Key: key,
        ConditionExpression: "#token = :token", ExpressionAttributeNames: { "#token": "token" }, ExpressionAttributeValues: { ":token": token } }));
    } catch (error) {
      // Do not replace a publication error or turn an already successful save into a failed response.
      // The lease expires after the longest possible writer invocation; conditional deletion cannot remove a new owner's lock.
      console.warn("document lock release failed", { meetingId, error: (error as Error).name });
    }
  }
}
