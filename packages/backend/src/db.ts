import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ACTIVE_STATUSES,
  meetingKeys,
  type MeetingRecord,
  type MeetingStatus,
  type PushSubscriptionRecord,
} from "@meeting-notes/shared";
import { env } from "./env.js";

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export async function getMeeting(meetingId: string): Promise<MeetingRecord | undefined> {
  const res = await ddb.send(new GetCommand({ TableName: env.tableName, Key: meetingKeys.meeting(meetingId) }));
  return res.Item as MeetingRecord | undefined;
}

export async function putMeeting(rec: MeetingRecord): Promise<void> {
  await ddb.send(
    new PutCommand({ TableName: env.tableName, Item: rec, ConditionExpression: "attribute_not_exists(PK)" }),
  );
}

export async function deleteMeeting(meetingId: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: env.tableName, Key: meetingKeys.meeting(meetingId) }));
}

export interface MeetingPage {
  items: MeetingRecord[];
  cursor?: string;
}

/** Newest first via GSI1 (owner, createdAt). Cursor is an opaque base64 of LastEvaluatedKey. */
export async function listMeetingsByOwner(ownerSub: string, cursor?: string, limit = 25): Promise<MeetingPage> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: env.tableName,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": meetingKeys.userGsi(ownerSub) },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: cursor ? JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) : undefined,
    }),
  );
  return {
    items: (res.Items ?? []) as MeetingRecord[],
    cursor: res.LastEvaluatedKey ? Buffer.from(JSON.stringify(res.LastEvaluatedKey)).toString("base64url") : undefined,
  };
}

export async function countActiveMeetings(ownerSub: string): Promise<number> {
  let count = 0;
  let cursor: string | undefined;
  do {
    const page = await listMeetingsByOwner(ownerSub, cursor, 100);
    count += page.items.filter((m) => ACTIVE_STATUSES.includes(m.status)).length;
    cursor = page.cursor;
  } while (cursor);
  return count;
}

export async function setMeetingStatus(meetingId: string, status: MeetingStatus, extra: Record<string, unknown> = {}) {
  const names: Record<string, string> = { "#status": "status", "#updatedAt": "updatedAt" };
  const values: Record<string, unknown> = { ":status": status, ":updatedAt": new Date().toISOString() };
  const sets = ["#status = :status", "#updatedAt = :updatedAt"];
  for (const [k, v] of Object.entries(extra)) {
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    sets.push(`#${k} = :${k}`);
  }
  await ddb.send(
    new UpdateCommand({
      TableName: env.tableName,
      Key: meetingKeys.meeting(meetingId),
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

export async function putPushSubscription(rec: PushSubscriptionRecord): Promise<void> {
  await ddb.send(new PutCommand({ TableName: env.tableName, Item: rec }));
}

export async function deletePushSubscription(ownerSub: string, endpointHash: string): Promise<void> {
  await ddb.send(new DeleteCommand({ TableName: env.tableName, Key: meetingKeys.push(ownerSub, endpointHash) }));
}

export async function listPushSubscriptions(ownerSub: string): Promise<PushSubscriptionRecord[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: env.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `USER#${ownerSub}`, ":sk": meetingKeys.pushPrefix },
    }),
  );
  return (res.Items ?? []) as PushSubscriptionRecord[];
}

/**
 * Claim a failed retry, or an explicit brief request on a completed meeting, without starting duplicate executions.
 * Returns false if the status changed or a request is pending; RegisterUpload clears the token.
 */
export async function claimRetry(meetingId: string, token: string, expectedStatus: "FAILED" | "COMPLETED" = "FAILED"): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: env.tableName,
        Key: meetingKeys.meeting(meetingId),
        UpdateExpression: "SET #rt = :t, #u = :now",
        ConditionExpression: "#status = :failed AND attribute_not_exists(#rt)",
        ExpressionAttributeNames: { "#rt": "retryToken", "#status": "status", "#u": "updatedAt" },
        ExpressionAttributeValues: { ":t": token, ":failed": expectedStatus, ":now": new Date().toISOString() },
      }),
    );
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

export async function releaseRetry(meetingId: string, token?: string): Promise<void> {
  await ddb.send(new UpdateCommand({ TableName: env.tableName, Key: meetingKeys.meeting(meetingId), UpdateExpression: "REMOVE #rt", ExpressionAttributeNames: { "#rt": "retryToken" }, ...(token ? { ConditionExpression: "#rt = :token", ExpressionAttributeValues: { ":token": token } } : {}) }));
}

/** The brief request is accepted: record the running job on the still-COMPLETED meeting so the UI can follow it. */
export async function markBriefRun(meetingId: string, executionArn: string): Promise<void> {
  await ddb.send(new UpdateCommand({
    TableName: env.tableName, Key: meetingKeys.meeting(meetingId),
    UpdateExpression: "SET briefStatus = :running, briefExecutionArn = :arn, #u = :now REMOVE briefError",
    ExpressionAttributeNames: { "#u": "updatedAt" }, ExpressionAttributeValues: { ":running": "RUNNING", ":arn": executionArn, ":now": new Date().toISOString() },
  }));
}
