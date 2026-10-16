import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, lectureTable } from "@meeting-notes/backend";
import { lecturePreferencesSchema, type LecturePreferences } from "@meeting-notes/shared";
import type { Caller } from "../lib/http.js";

const key = (sub: string) => ({ PK: `USER#${sub}`, SK: "LECTURE_PREFERENCES" });
export async function getLecturePreferences(caller: Caller): Promise<LecturePreferences> {
  const result = await ddb.send(new GetCommand({ TableName: lectureTable(), Key: key(caller.sub), ConsistentRead: true }));
  return lecturePreferencesSchema.parse(result.Item?.preferences ?? {});
}
export async function saveLecturePreferences(caller: Caller, preferences: LecturePreferences): Promise<LecturePreferences> {
  const value = lecturePreferencesSchema.parse(preferences);
  await ddb.send(new PutCommand({ TableName: lectureTable(), Item: { ...key(caller.sub), preferences: value, updatedAt: new Date().toISOString() } }));
  return value;
}
