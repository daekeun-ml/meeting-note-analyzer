import { expect, it } from "vitest";
import { briefFollowUps, briefToMarkdown, type NotesDocument } from "../src/index.js";

const doc = {
  outputLanguage: "ko", detectedLanguage: "ko", speakers: [{ id: "S1", label: "새 이름" }],
  followUps: [{ id: "F1", title: "업로드 테스트", ownerSpeakerId: "S1" }, { id: "F2", title: "문서 작성" }],
  brief: { headline: "핵심 기능 우선 출시", decisions: [{ decision: "검색부터 출시", process: "추측으로 작성한 이유", rationaleStatus: "not_recorded" }], followUpIds: ["F2", "F1"], openQuestions: [{ question: "출시일 확정" }], omittedCounts: { decisions: 1, followUps: 0, openQuestions: 0 } },
} as unknown as NotesDocument;

it("copies a compact recap with explicitly unknown reasons and due dates", () => {
  const text = briefToMarkdown(doc);
  expect(text).toContain("결정 근거 미확인");
  expect(text).not.toContain("추측으로 작성한 이유");
  expect(text).toContain("업로드 테스트 (담당: 새 이름, 기한: 미정)");
  expect(text).toContain("문서 작성 (담당: 미정, 기한: 미정)");
  expect(text).toContain("나머지 항목은 상세 내용");
});
it("keeps chosen action order and follows later name changes", () => {
  expect(briefFollowUps(doc).map((f) => f.id)).toEqual(["F2", "F1"]);
  expect(briefFollowUps({ ...doc, speakers: [{ id: "S1", label: "바뀐 이름" }] as NotesDocument["speakers"] })[1]?.ownerName).toBe("바뀐 이름");
});
it("supports old documents and auto-detected English without a synthetic brief", () => {
  expect(briefToMarkdown({ ...doc, brief: undefined })).toBe("");
  expect(briefToMarkdown({ ...doc, outputLanguage: "auto", detectedLanguage: "en" })).toContain("Decision rationale not recorded");
});
