import csv
import io

DIFFICULTY = {"basic": "기본", "understand": "이해", "apply": "적용"}
NOTE_KIND = {"definition": "정의", "theorem": "정리", "lemma": "보조정리", "formula": "공식", "example": "예제"}


def markdown(document: dict) -> str:
    lines = [f"# {document['title']}", "", document["overview"]]
    audience = document.get("audience")
    if audience:
        lines.extend(["", "## 이 강의의 대상", f"- 수준: {audience['level']}", f"- 전제 지식: {', '.join(audience['priorKnowledge']) or '없음'}", f"- 강의 목표: {audience['lectureGoal']}"])
    lines.extend(["", "## 학습 목표"])
    lines.extend(f"- {x}" for x in document["learningObjectives"])
    lines.extend(["", "## 복습 순서", *[f"- {x}" for x in document["reviewPlan"]]])
    for page in document["pages"]:
        lines.extend(["", f"## {page['page']}. {page['title']}"])
        if page.get("videoRanges"):
            lines.extend(["", "### 영상 구간"])
            lines.extend(f"- {int(r['startSec']) // 60:02d}:{int(r['startSec']) % 60:02d} ~ {int(r['endSec']) // 60:02d}:{int(r['endSec']) % 60:02d}" for r in page["videoRanges"])
        alignment = "영상 시간 기준" if page["alignment"].get("method") == "video_time" else f"{page['alignment']['status']} ({page['alignment']['confidence']:.0%})"
        lines.extend(["", "### 화면 요약" if page.get("source") == "video" else "### 장표 요약", page["slideSummary"], "", "### 수업에서 언급된 내용", page["spokenSummary"] or "대응하는 발언을 확인하지 못했습니다.", f"연결: {alignment}", "", "### 학습 보충 설명", page["explanation"], "", "### 핵심 개념"])
        lines.extend(f"- **{x['term']}**: {x['explanation']}" for x in page["concepts"])
        if page.get("mathNotes"):
            lines.extend(["", "### 수식과 정리"])
            for note in page["mathNotes"]:
                lines.extend([f"- **[{NOTE_KIND[note['kind']]}] {note['name']}**", f"  {note['statement']}"])
                lines.extend(f"  {i}. {step}" for i, step in enumerate(note["steps"], 1))
                if note["intuition"]:
                    lines.append(f"  직관: {note['intuition']}")
                if note["supplementary"]:
                    lines.append("  (강의에서 생략된 증명을 보충했습니다)")
        lines.extend(["", "### 복습 문제"])
        for question in page["reviewQuestions"]:
            lines.extend([f"- 질문 ({DIFFICULTY[question.get('difficulty', 'basic')]}): {question['question']}", f"  정답: {question['answer']}"])
        lines.extend(["", "### 발언 근거"])
        lines.extend(f"- [{int(e['start']) // 60:02d}:{int(e['start']) % 60:02d}] ({e['segmentId']}) {e['text']}" for e in page["evidence"])
        lines.extend(["", "### 참고 논문"])
        for paper in page["research"]["papers"]:
            title = paper["title"].replace("[", "\\[").replace("]", "\\]").replace("\n", " ")
            lines.extend([f"- [{title}](<{paper['url']}>)", f"  관련성: {paper['relevance']}", f"  읽을 부분: {paper['readingFocus']}"])
        if page["research"]["status"] == "failed":
            lines.append("논문 검색을 완료하지 못했습니다. 앱에서 다시 시도할 수 있습니다.")
        elif not page["research"]["papers"]:
            lines.append("참고 논문이 없습니다.")
    if document["warnings"]:
        lines.extend(["", "## 확인할 사항", *[f"- {x}" for x in document["warnings"]]])
    return "\n".join(lines) + "\n"


def flashcard_csv(document: dict) -> str:
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["Front", "Back", "Page", "Lecture"])
    def safe(value):
        text = str(value)
        return "'" + text if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else text
    for page in document["pages"]:
        for card in page["flashcards"]:
            writer.writerow([safe(card["front"]), safe(card["back"]), page["page"], safe(document["title"])])
    return "\ufeff" + output.getvalue()
