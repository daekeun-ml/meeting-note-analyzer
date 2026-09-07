import { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand, type TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";
import { lectureKeys, type LectureRecord } from "@meeting-notes/shared";
import { ddb } from "./db.js";
import { requireEnv } from "./env.js";

export const lectureTable = () => requireEnv("LECTURE_TABLE_NAME");
export async function getLecture(id: string): Promise<LectureRecord | undefined> {
  return (await ddb.send(new GetCommand({ TableName: lectureTable(), Key: lectureKeys.record(id), ConsistentRead: true }))).Item as LectureRecord | undefined;
}
export async function listLectures(owner: string, cursor?: string, limit = 25) {
  const result = await ddb.send(new QueryCommand({
    TableName: lectureTable(), IndexName: "GSI1", KeyConditionExpression: "GSI1PK = :owner",
    ExpressionAttributeValues: { ":owner": lectureKeys.user(owner) }, ScanIndexForward: false, Limit: limit,
    ExclusiveStartKey: cursor ? JSON.parse(Buffer.from(cursor, "base64url").toString()) : undefined,
  }));
  return { items: (result.Items ?? []) as LectureRecord[], cursor: result.LastEvaluatedKey ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64url") : null };
}
/** Execution lease prevents an expired attempt from changing a newer run or recreating a deleted record. */
export async function updateLectureRun(id: string, runId: string, fields: Record<string, unknown>, remove: string[] = []) {
  const names: Record<string, string> = { "#run": "runId" };
  const values: Record<string, unknown> = { ":run": runId };
  const sets = Object.entries({ ...fields, updatedAt: new Date().toISOString() }).filter(([, v]) => v !== undefined).map(([k, v], i) => {
    names[`#f${i}`] = k; values[`:v${i}`] = v; return `#f${i} = :v${i}`;
  });
  remove.forEach((key, i) => { names[`#r${i}`] = key; });
  await ddb.send(new UpdateCommand({ TableName: lectureTable(), Key: lectureKeys.record(id),
    UpdateExpression: `SET ${sets.join(", ")}${remove.length ? ` REMOVE ${remove.map((_, i) => `#r${i}`).join(", ")}` : ""}`,
    ConditionExpression: "attribute_exists(PK) AND #run = :run", ExpressionAttributeNames: names, ExpressionAttributeValues: values,
  }));
}

/** Knowledge-base sidecar for a published lecture study document; the chat runtime filters on `owner` and routes evidence by `kind`. */
export function lectureKbMetadata(rec: Pick<LectureRecord, "owner" | "lectureId" | "title" | "course">, doc: { generatedAt?: string; outputLanguage?: string; durationSec?: number; pages?: unknown[]; audience?: { level?: string } | null }): string {
  return JSON.stringify({
    metadataAttributes: {
      owner: rec.owner, kind: "lecture", lectureId: rec.lectureId, title: rec.title, course: rec.course,
      date: (doc.generatedAt ?? "").slice(0, 10), language: doc.outputLanguage ?? "", pageCount: doc.pages?.length ?? 0,
      durationMin: Math.round((doc.durationSec ?? 0) / 60), level: doc.audience?.level ?? "",
    },
  });
}

export const ACTIVE_LECTURE_STATUSES: LectureRecord["status"][] = ["UPLOAD_PENDING", "UPLOADED", "PREPARING", "TRANSCRIBING", "ANALYZING"];
export class LectureLimitError extends Error {
  override readonly name = "LectureLimitError";
  constructor(readonly max: number) { super(`처리 중인 강의가 ${max}건입니다. 완료 후 다시 시도하세요`); }
}
type TransactWriteItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];
const slotKey = (owner: string) => ({ PK: lectureKeys.user(owner), SK: "ACTIVE" });

export async function countActiveLectures(owner: string): Promise<number> {
  let cursor: string | undefined; let active = 0;
  do {
    const page = await listLectures(owner, cursor, 100);
    active += page.items.filter((x) => ACTIVE_LECTURE_STATUSES.includes(x.status)).length;
    cursor = page.cursor ?? undefined;
  } while (cursor);
  return active;
}

/**
 * Claims one of `max` concurrent processing slots for the owner in the same transaction as the caller's own write
 * (record creation or a status claim), so every start path is limited atomically. A drifted counter (a release that
 * never ran) is healed from the real active count before giving up.
 */
export async function claimLectureSlot(owner: string, max: number, write: TransactWriteItem, healed = false): Promise<void> {
  const counter = { Update: { TableName: lectureTable(), Key: slotKey(owner), UpdateExpression: "SET #n = if_not_exists(#n, :zero) + :one",
    ConditionExpression: "attribute_not_exists(#n) OR #n < :max", ExpressionAttributeNames: { "#n": "count" }, ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":max": max } } };
  try { await ddb.send(new TransactWriteCommand({ TransactItems: [counter, write] })); }
  catch (error) {
    const failure = error as { name?: string; CancellationReasons?: { Code?: string }[] };
    if (failure.name !== "TransactionCanceledException" || !failure.CancellationReasons) throw error;
    if (failure.CancellationReasons[1]?.Code === "ConditionalCheckFailed") throw Object.assign(new Error("lecture state changed"), { name: "ConditionalCheckFailedException" });
    if (failure.CancellationReasons[0]?.Code !== "ConditionalCheckFailed") throw error;
    const active = await countActiveLectures(owner);
    if (healed || active >= max) throw new LectureLimitError(max);
    await ddb.send(new UpdateCommand({ TableName: lectureTable(), Key: slotKey(owner), UpdateExpression: "SET #n = :n", ExpressionAttributeNames: { "#n": "count" }, ExpressionAttributeValues: { ":n": active } }));
    return claimLectureSlot(owner, max, write, true);
  }
}
/** Frees a slot when a lecture stops being active (completed, failed, or deleted before it started). Never goes below zero. */
export async function releaseLectureSlot(owner: string): Promise<void> {
  try {
    await ddb.send(new UpdateCommand({ TableName: lectureTable(), Key: slotKey(owner), UpdateExpression: "SET #n = #n - :one", ConditionExpression: "#n > :zero",
      ExpressionAttributeNames: { "#n": "count" }, ExpressionAttributeValues: { ":one": 1, ":zero": 0 } }));
  } catch (error) { if ((error as { name?: string }).name !== "ConditionalCheckFailedException") throw error; }
}
