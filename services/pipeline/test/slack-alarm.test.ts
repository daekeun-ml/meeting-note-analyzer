import { describe, expect, it } from "vitest";
import { formatSlackMessage } from "../src/handlers/slack-alarm.js";

describe("formatSlackMessage", () => {
  it("renders a Korean headline from the description with state and reason", () => {
    const msg = formatSlackMessage({ AlarmName: "MeetingNotes-Pipeline-PipelineFailed1A7471C7-x", AlarmDescription: "A meeting pipeline execution failed", NewStateValue: "ALARM", NewStateReason: "Threshold Crossed: 1 datapoint [1.0] was >= 1.0", StateChangeTime: "2026-09-06T05:00:00.000+0000", Region: "us-east-1", Trigger: { MetricName: "ExecutionsFailed", Namespace: "AWS/States" } });
    expect(msg.text).toBe("[회의록 시스템] 알람 발생: A meeting pipeline execution failed");
    expect(msg.attachments[0]!.color).toBe("#e5484d");
    expect(msg.attachments[0]!.text).toContain("사유: Threshold Crossed");
    expect(msg.attachments[0]!.text).toContain("2026-09-06 14:00");
    expect(msg.attachments[0]!.footer).toContain("PipelineFailed");
    expect(msg.text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
  it("marks recovery as 해제 with a green bar", () => {
    const msg = formatSlackMessage({ AlarmName: "a", AlarmDescription: "STT async queue has a request older than 40 minutes", NewStateValue: "OK" });
    expect(msg.text).toContain("해제");
    expect(msg.attachments[0]!.color).toBe("#30a46c");
  });
});
