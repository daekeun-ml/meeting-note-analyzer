import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, env } from "@meeting-notes/backend";
import { meetingKeys, type MeetingStatus, type Stage, type StageStatus } from "@meeting-notes/shared";

/** Generic SET update on the meeting item. Values that are undefined are skipped. */
export async function updateMeeting(meetingId: string, fields: Record<string, unknown>, condition?: { expression: string; values?: Record<string, unknown>; names?: Record<string, string> }, remove: string[] = []) {
  const names: Record<string, string> = { "#updatedAt": "updatedAt", ...(condition?.names ?? {}) };
  const values: Record<string, unknown> = { ":updatedAt": new Date().toISOString(), ...(condition?.values ?? {}) };
  const sets = ["#updatedAt = :updatedAt"];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    names[`#${k}`] = k;
    values[`:${k}`] = v;
    sets.push(`#${k} = :${k}`);
  }
  for (const k of remove) names[`#${k}`] = k;
  await ddb.send(
    new UpdateCommand({
      TableName: env.tableName,
      Key: meetingKeys.meeting(meetingId),
      UpdateExpression: `SET ${sets.join(", ")}${remove.length ? ` REMOVE ${remove.map((k) => `#${k}`).join(", ")}` : ""}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: condition?.expression,
    }),
  );
}

export async function setStatus(meetingId: string, status: MeetingStatus, extra: Record<string, unknown> = {}) {
  await updateMeeting(meetingId, { status, ...extra });
}

export async function setStage(meetingId: string, stage: Stage | "stt", status: StageStatus, extra: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, ...extra };
  if (status === "RUNNING") patch["startedAt"] = now;
  if (status === "COMPLETED" || status === "FAILED") patch["endedAt"] = now;
  await ddb.send(
    new UpdateCommand({
      TableName: env.tableName,
      Key: meetingKeys.meeting(meetingId),
      UpdateExpression: "SET #stages.#stage = :patch, #updatedAt = :now, #currentStage = :stage",
      ExpressionAttributeNames: { "#stages": "stages", "#stage": stage, "#updatedAt": "updatedAt", "#currentStage": "currentStage" },
      ExpressionAttributeValues: { ":patch": patch, ":now": now, ":stage": stage },
    }),
  );
}
