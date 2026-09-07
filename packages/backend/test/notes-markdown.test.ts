import { describe, expect, it } from "vitest";
import type { NotesDocument } from "@meeting-notes/shared";
import { notesToMarkdown } from "../src/notes-markdown.js";
import { kbMetadata } from "../src/documents.js";

const doc = {
  version: 1,
  meetingId: "m1",
  title: "주간회의",
  generatedAt: "2026-09-05T12:00:00.000Z",
  outputLanguage: "ko",
  detectedLanguage: "ko",
  durationSec: 240,
  speakers: [{ id: "S1", label: "김민수", role: "PM", confidence: 0.9, evidence: [] }],
  topics: [],
  meetingType: "주간 정기회의",
  purpose: "",
  summary: { headline: "h", overview: "o", keyDecisions: ["d1"], keyDiscussions: [], risksAndIssues: [], nextSteps: [], markdown: "" },
  agenda: [{ id: "A1", title: "결제", background: "", discussionPoints: [], decisions: [], openQuestions: ["q"], participants: [], startSec: 0, endSec: 1, topicIds: [] }],
  notes: { markdown: "- n", sections: [] },
  followUps: [{ id: "F1", title: "부하 테스트", ownerName: "이서현", dueHint: "목요일", priority: "high", evidenceSegmentIds: [], status: "new" }],
  suggestions: [],
  mindmap: {
    nodes: [{ id: "n1", parentId: null, label: "주간회의", kind: "root" }, { id: "n2", parentId: "n1", label: "결제", kind: "agenda", ref: "A1" }],
    review: { verdict: "pass", findings: [] },
    coverage: { agenda: 1, followUps: 1, decisions: 1 },
    mermaid: "mindmap\n  root((주간회의))\n    n2(결제)\n",
    outline: "- 주간회의\n  - 결제\n",
  },
  transcriptAnalysis: { languages: [], primaryLanguage: "ko", quality: { overall: "good", issues: [] }, glossary: [] },
} as unknown as NotesDocument;

describe("notesToMarkdown", () => {
  it("renders the mind map as a mermaid block with an outline and uses no decorative punctuation", () => {
    const md = notesToMarkdown(doc);
    expect(md).toContain("## 마인드맵");
    expect(md).toContain("```mermaid\nmindmap\n  root((주간회의))");
    expect(md).toContain("- 주간회의\n  - 결제");
    expect(md).toContain("_검증: 안건 100%, F/U 항목 100%, 결정 사항 100%_");
    expect(md).toContain("- 김민수: PM");
    expect(md).toContain("담당: 이서현, 기한: 목요일");
    expect(md).not.toMatch(/[·—•]/);
  });

  it("omits the section for documents without a mind map", () => {
    const md = notesToMarkdown({ ...doc, mindmap: undefined });
    expect(md).not.toContain("마인드맵");
  });

  it("appends the new recap after the detailed document and leaves older documents intact", () => {
    expect(notesToMarkdown(doc)).not.toContain("한눈에 보는 요약");
    const md = notesToMarkdown({ ...doc, brief: { headline: "핵심 기능 우선 출시", decisions: [], followUpIds: ["F1"], openQuestions: [], omittedCounts: { decisions: 0, followUps: 0, openQuestions: 0 } } });
    expect(md.indexOf("## 한눈에 보는 요약")).toBeGreaterThan(md.indexOf("## 마인드맵"));
    expect(md).toContain("부하 테스트 (담당: 이서현, 기한: 목요일)");
  });
});

describe("kbMetadata", () => {
  it("emits Knowledge Base sidecar attributes for filtering", () => {
    const meta = JSON.parse(kbMetadata("u1", doc));
    expect(meta.metadataAttributes).toMatchObject({ owner: "u1", meetingId: "m1", date: "2026-09-05", speakers: "김민수", durationMin: 4, agendaCount: 1, followUpCount: 1 });
  });
});
