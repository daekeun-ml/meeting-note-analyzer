import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SPEECH_MODELS, speechLanguageError, speechModelsSchema } from "@meeting-notes/shared";
const send = vi.hoisted(() => vi.fn());
vi.mock("@meeting-notes/backend", () => ({ ddb: { send }, env: { tableName: "preferences-table" } }));
import { getSpeechPreferences, saveSpeechPreferences } from "../src/routes/speech-preferences.js";

beforeEach(() => { send.mockReset(); delete process.env["SPEECH_PREFERENCES_TABLE_NAME"]; });
it("defaults to Qwen and Nemotron and isolates saved choices by account", async () => {
  const records = new Map<string, unknown>();
  send.mockImplementation(async ({ input }) => {
    if (input.Item) records.set(input.Item.PK, input.Item);
    return { Item: records.get(input.Key?.PK) };
  });
  expect(await getSpeechPreferences({ sub: "u1" })).toEqual(DEFAULT_SPEECH_MODELS);
  const choices = { stt: "crisperwhisper", diarization: "community1" } as const;
  expect(await saveSpeechPreferences({ sub: "u1" }, choices)).toEqual(choices);
  expect(await getSpeechPreferences({ sub: "u1" })).toEqual(choices);
  expect(await getSpeechPreferences({ sub: "u2" })).toEqual(DEFAULT_SPEECH_MODELS);
  expect(send.mock.calls.every(([command]) => command.input.TableName === "preferences-table")).toBe(true);
});
it("reads the shared table and rejects unsupported models", async () => {
  process.env["SPEECH_PREFERENCES_TABLE_NAME"] = "shared-main-table";
  send.mockResolvedValue({});
  expect(await getSpeechPreferences({ sub: "owner" })).toEqual(DEFAULT_SPEECH_MODELS);
  expect(send.mock.calls[0]![0].input).toMatchObject({ TableName: "shared-main-table", Key: { PK: "USER#owner", SK: "SPEECH_PREFERENCES" } });
  expect(speechModelsSchema.safeParse({ stt: "cohere", diarization: "nemotron3" }).success).toBe(false);
  expect(speechModelsSchema.safeParse({ stt: "other/repo", diarization: "community1" }).success).toBe(false);
  expect(speechLanguageError({ stt: "ark-asr", diarization: "nemotron3" }, "ko")).toContain("영어");
  expect(speechLanguageError({ stt: "ark-asr", diarization: "nemotron3" }, "en")).toBeNull();
});
