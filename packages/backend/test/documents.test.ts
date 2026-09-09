import { describe, expect, it } from "vitest";
import type { NotesDocument } from "@meeting-notes/shared";
import { applySpeakerLabels, kbMetadata } from "../src/documents.js";

const doc = {
  meetingId: "m1", title: "주간회의", generatedAt: "2026-09-06T01:00:00Z", meetingType: "주간", outputLanguage: "ko", durationSec: 600,
  speakers: [{ id: "S1", label: "발표자", confidence: 0.9, evidence: [] }, { id: "S2", label: "질문자", confidence: 0.8, evidence: [] }],
  agenda: [], followUps: [{ id: "F1", title: "JD 작성", ownerName: "발표자", priority: "high", sourceSegmentIds: [] }, { id: "F2", title: "예산 확인", ownerName: "질문자", priority: "low", sourceSegmentIds: [] }],
  suggestions: [],
} as unknown as NotesDocument;

describe("applySpeakerLabels", () => {
  it("renames speakers and follow-up owners that used the old label", () => {
    const { doc: out, changed } = applySpeakerLabels(doc, { S1: "이서현", S9: "무시" });
    expect(changed).toBe(1);
    expect(out.speakers.map((s) => s.label)).toEqual(["이서현", "질문자"]);
    expect(out.speakers[0]!.name).toBe("이서현");
    expect(out.followUps.map((f) => f.ownerName)).toEqual(["이서현", "질문자"]);
    expect(doc.speakers[0]!.label).toBe("발표자"); // input untouched
  });
  it("is a no-op for unchanged names", () => {
    expect(applySpeakerLabels(doc, { S1: " 발표자 " }).changed).toBe(0);
  });
  it("records manual name confirmation and clears only the identity proposal", () => {
    const uncertain = { ...doc, speakers: [{ ...doc.speakers[0]!, label: "S1", reviewRequired: true, proposedLabel: "이름 후보", reviewReason: "context_only" }] };
    const { doc: out, changed } = applySpeakerLabels(uncertain, { S1: "확인한 이름" });
    expect(changed).toBe(1);
    expect(out.speakers[0]).toMatchObject({ label: "확인한 이름", reviewRequired: false, nameConfirmedByUser: true });
    expect(out.speakers[0]).not.toHaveProperty("proposedLabel");
    expect(uncertain.speakers[0]!.reviewRequired).toBe(true);
  });
  it("kbMetadata carries the owner and current speaker labels", () => {
    const meta = JSON.parse(kbMetadata("sub-1", applySpeakerLabels(doc, { S2: "박지훈" }).doc)) as { metadataAttributes: Record<string, unknown> };
    expect(meta.metadataAttributes.owner).toBe("sub-1");
    expect(meta.metadataAttributes.speakers).toBe("발표자, 박지훈");
  });
});
