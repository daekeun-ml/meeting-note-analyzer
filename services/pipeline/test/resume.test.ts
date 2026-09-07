import { describe, expect, it } from "vitest";
import type { MeetingRecord } from "@meeting-notes/shared";
import { completedStageKey, resumePlan } from "../src/lib/resume.js";

const base = { transcriptKey: "transcripts/m/transcript.json", stages: { stt: { status: "COMPLETED" }, transcript_analysis: { status: "COMPLETED", s3Key: "results/m/transcript_analysis.json" }, topic_segmentation: { status: "FAILED" } } } as unknown as MeetingRecord;

describe("resumePlan", () => {
  it("resumes after STT at the first stage that did not complete", () => {
    expect(resumePlan(base)).toEqual({ hasTranscript: true, status: "ANALYZING", firstStage: "topic_segmentation" });
  });
  it("restarts from STT when there is no transcript", () => {
    expect(resumePlan({ stages: { stt: { status: "FAILED" } } } as unknown as MeetingRecord)).toEqual({ hasTranscript: false, status: "TRANSCRIBING", firstStage: "stt" });
  });
});

describe("completedStageKey", () => {
  it("returns the stored key only for completed stages", () => {
    expect(completedStageKey(base, "transcript_analysis")).toBe("results/m/transcript_analysis.json");
    expect(completedStageKey(base, "topic_segmentation")).toBeNull();
    expect(completedStageKey(base, "agenda")).toBeNull();
  });
});
