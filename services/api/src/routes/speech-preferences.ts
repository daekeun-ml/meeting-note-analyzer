import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb, env } from "@meeting-notes/backend";
import { DEFAULT_SPEECH_MODELS, speechModelsSchema, type SpeechModels } from "@meeting-notes/shared";
import type { Caller } from "../lib/http.js";

const table = () => process.env["SPEECH_PREFERENCES_TABLE_NAME"] || env.tableName;
const key = (sub: string) => ({ PK: `USER#${sub}`, SK: "SPEECH_PREFERENCES" });

export async function getSpeechPreferences(caller: Caller): Promise<SpeechModels> {
  const result = await ddb.send(new GetCommand({ TableName: table(), Key: key(caller.sub), ConsistentRead: true }));
  return speechModelsSchema.parse(result.Item?.preferences ?? DEFAULT_SPEECH_MODELS);
}

export async function saveSpeechPreferences(caller: Caller, input: SpeechModels): Promise<SpeechModels> {
  const preferences = speechModelsSchema.parse(input);
  await ddb.send(new PutCommand({ TableName: table(), Item: { ...key(caller.sub), preferences, updatedAt: new Date().toISOString() } }));
  return preferences;
}
