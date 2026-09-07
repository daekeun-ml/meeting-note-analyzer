import { describe, expect, it } from "vitest";
import { normalize } from "../src/handlers/normalize-transcript.js";
import { describeError } from "../src/handlers/mark-failed.js";
import { buildSttRequest } from "../src/handlers/start-transcription.js";
import { hms } from "../src/lib/transcript-format.js";

const base = {
  version: 1 as const,
  meetingId: "m1",
  language: "ko",
  durationSec: 12.5,
  mode: "intended" as const,
  model: "test",
  speakers: [],
  stats: {},
};

describe("normalize", () => {
  it("sorts, assigns ids, drops empty text and recomputes talk time", () => {
    const t = normalize({
      ...base,
      segments: [
        { id: "", start: 5, end: 8, speaker: "S2", text: " second ", words: [] },
        { id: "", start: 0, end: 4, speaker: "S1", text: "first", words: [] },
        { id: "", start: 9, end: 10, speaker: "S1", text: "   ", words: [] },
      ],
    });
    expect(t.segments.map((s) => s.id)).toEqual(["seg-0001", "seg-0002"]);
    expect(t.segments[0]?.text).toBe("first");
    expect(t.speakers).toEqual([{ id: "S1", talkTimeSec: 4 }, { id: "S2", talkTimeSec: 3 }]);
  });
});

describe("helpers", () => {
  it("formats hh:mm:ss", () => expect(hms(3725)).toBe("01:02:05"));
  it("unwraps Lambda errorMessage causes", () => {
    expect(describeError({ Error: "AgentInvokeError", Cause: JSON.stringify({ errorMessage: "boom" }) })).toBe("AgentInvokeError: boom");
    expect(describeError({ Error: "States.Timeout" })).toBe("States.Timeout");
  });
  it("builds the STT request with null language for auto", () => {
    const req = buildSttRequest({ taskToken: "t", meetingId: "m", ownerSub: "u", audioKey: "uploads/u/m/audio.mp3", languageHint: "auto" }, "bkt", "intended");
    expect(req.audio_s3_uri).toBe("s3://bkt/uploads/u/m/audio.mp3");
    expect(req.language).toBeNull();
  });
});

describe("sttOutputSchema", () => {
  it("accepts null word probabilities emitted by the container", async () => {
    const { sttOutputSchema } = await import("@meeting-notes/shared");
    const parsed = sttOutputSchema.parse({ ...base, segments: [{ id: "seg-0001", start: 0, end: 1, speaker: "S1", text: "hi", words: [{ w: "hi", s: 0, e: 1, p: null }] }] });
    expect(parsed.segments[0]?.words[0]?.p).toBeNull();
  });
});
