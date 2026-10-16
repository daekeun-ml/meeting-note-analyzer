import copy
import json

import pytest
from PIL import Image

from lecture_study.lecture_model import LectureModel
from lecture_study.schemas import Study
from lecture_study.study import validate_references
from lecture_study.text_integrity import DRAFT_MARKER, SOURCE_MARKER, source_text_view, validate_text_integrity


def study():
    return {"slideSummary": "학습 내용을 정리합니다.", "spokenSummary": "", "explanation": "근거가 있는 설명입니다.",
            "concepts": [{"term": "확률", "explanation": "사건이 발생할 가능성을 나타냅니다."}],
            "mathNotes": [], "relatedPages": [], "reviewQuestions": [], "flashcards": [], "searchQueries": []}


def response(value, stop="tool_use"):
    return {"stopReason": stop, "usage": {"inputTokens": 3, "outputTokens": 2},
            "output": {"message": {"content": [{"toolUse": {"name": "deliver", "input": value}}]}}}


def schema_name(request):
    return request["toolConfig"]["tools"][0]["toolSpec"]["inputSchema"]["json"]["title"]


def data(request):
    return json.loads(request["messages"][0]["content"][0]["text"].split("INPUT DATA:\n", 1)[1])


def texts(request):
    return "\n".join(item["text"] for item in request["messages"][0]["content"] if "text" in item)


def test_source_view_marks_lost_characters_without_mutating_original_speech_or_guessing_terms():
    source = {"nativeText": r"Dropout: $p=0.5$", "recordedSpeech": [
        {"id": "seg-1", "start": 12.3, "end": 15, "text": "드\ufffd\ufffd럽하웃과 깨\ufffd듯한 데이터"},
        {"id": "seg-2", "start": 16, "end": 18, "text": "수식 \ud800 글자"},
    ]}
    original = copy.deepcopy(source)
    view = source_text_view(source)
    assert view["recordedSpeech"][0] == {**source["recordedSpeech"][0], "text": f"드{SOURCE_MARKER}럽하웃과 깨{SOURCE_MARKER}듯한 데이터"}
    assert view["sourceTextIntegrity"]["unreadableFieldCount"] == 2
    assert view["nativeText"] == source["nativeText"]
    assert source == original
    json.dumps(view, ensure_ascii=False).encode("utf-8")
    assert source_text_view(view) == view
    clean = {"text": r"Café, 언어 모델, $\nabla f(x)$, literal \ufffd"}
    assert source_text_view(clean) == clean
    validate_text_integrity(clean)


@pytest.mark.parametrize("damaged", ["잘못된 \ufffd 글자", "잘못된 \ud800 글자", f"드{SOURCE_MARKER}롭아웃"])
def test_damaged_generated_prose_is_repaired_in_one_field_using_original_evidence(damaged):
    original = study()
    original["slideSummary"] = damaged
    snapshot = copy.deepcopy(original)
    source = {"outputLanguage": "ko", "nativeText": "Dropout reduces co-adaptation.", "recordedSpeech": [{"text": "드\ufffd롭아웃"}]}
    source_snapshot = copy.deepcopy(source)

    class Client:
        calls = []

        def converse(self, **kwargs):
            self.calls.append(kwargs)
            assert "\ufffd" not in texts(kwargs) and "\ud800" not in texts(kwargs)
            if len(self.calls) == 1:
                assert data(kwargs)["recordedSpeech"][0]["text"] == f"드{SOURCE_MARKER}롭아웃"
                return response(original)
            assert schema_name(kwargs) == "LectureUnicodeRepair"
            repair = data(kwargs)
            assert repair["source"]["nativeText"] == source["nativeText"]
            assert repair["repairs"]["field_0"]["path"] == "output.slideSummary"
            assert DRAFT_MARKER in repair["repairs"]["field_0"]["draft"]
            return response({"field_0": "Dropout은 특정 뉴런에 대한 과도한 의존을 줄입니다."})

    client = Client()
    result = LectureModel(client=client, max_calls=2).generate(Study, "Study", source)
    assert result.slideSummary.startswith("Dropout")
    assert result.model_dump(exclude={"slideSummary"}) == Study.model_validate({**original, "slideSummary": "비교용 정상 문장"}).model_dump(exclude={"slideSummary"})
    assert original == snapshot and source == source_snapshot
    assert len(client.calls) == 2


def test_unreadable_formula_repair_gets_original_images_and_keeps_uncertainty(tmp_path):
    original = study()
    note = {"kind": "formula", "name": "식의 관계", "statement": r"$x \ufffd y$".replace(r"\ufffd", "\ufffd"),
            "steps": [], "intuition": "두 값의 관계", "supplementary": False}
    original["mathNotes"] = [note, {**note, "name": "확인된 식", "statement": "$x=y$"}]
    image = tmp_path / "source.png"
    Image.new("RGB", (8, 8)).save(image)
    fixed = {**note, "statement": r"$x\ \text{기호 판독 불가}\ y$",
             "sourceCheck": {"status": "uncertain", "explanation": "두 변수 사이의 기호를 원자료에서 확인할 수 없습니다.", "correctedStatement": ""}}

    class Client:
        calls = []

        def converse(self, **kwargs):
            self.calls.append(kwargs)
            if len(self.calls) == 1:
                return response(original)
            assert len([item for item in kwargs["messages"][0]["content"] if "image" in item]) == 1
            assert list(data(kwargs)["repairs"]) == ["field_0"]
            assert data(kwargs)["repairs"]["field_0"]["path"] == "output.mathNotes[0]"
            return response({"field_0": fixed})

    result = LectureModel(client=Client(), max_calls=2).generate(Study, "Study", {"nativeText": "x \ufffd y"}, images=[image])
    assert result.mathNotes[0].sourceCheck.status == "uncertain"
    assert result.mathNotes[0].statement == fixed["statement"]
    assert result.mathNotes[1].model_dump() == Study.model_validate(original).mathNotes[1].model_dump()


def test_a_unicode_patch_cannot_change_source_page_references():
    original = study()
    original["relatedPages"] = [{"page": 1, "topic": "정의 \ufffd"}]

    class Client:
        requests = []

        def converse(self, **kwargs):
            self.requests.append(kwargs)
            if len(self.requests) == 1:
                return response(original)
            if len(self.requests) == 2:
                return response({"field_0": {"page": 99, "topic": "정의"}})
            assert "preserve the original source reference" in texts(kwargs)
            return response({"field_0": {"page": 1, "topic": "정의"}})

    client = Client()
    result = LectureModel(client=client, max_calls=3).generate(Study, "Study", {},
        validate=lambda value: validate_references(value, {"pages": [{"page": 1}]}))
    assert result.relatedPages[0].page == 1
    assert [schema_name(request) for request in client.requests] == ["Study", "LectureUnicodeRepair", "LectureUnicodeRepair"]


def test_repaired_text_still_goes_through_full_evidence_validation():
    original = study()
    original["slideSummary"] = "요약 \ufffd"
    original["relatedPages"] = [{"page": 99, "topic": "없는 참조"}]

    class Client:
        calls = []

        def converse(self, **kwargs):
            self.calls.append(kwargs)
            if len(self.calls) == 1:
                return response(original)
            if len(self.calls) == 2:
                return response({"field_0": "요약입니다."})
            assert "supplied source pages" in texts(kwargs)
            return response(study())

    client = Client()
    result = LectureModel(client=client, max_calls=3).generate(Study, "Study", {}, validate=lambda value: validate_references(value, {}))
    assert result.relatedPages == []
    assert [schema_name(request) for request in client.calls] == ["Study", "LectureUnicodeRepair", "Study"]


def test_failed_patch_retries_never_feed_the_bad_glyph_back_to_the_model():
    original = study()
    original["slideSummary"] = "요약 \ufffd"

    class Client:
        calls = 0

        def converse(self, **kwargs):
            self.calls += 1
            assert "\ufffd" not in texts(kwargs)
            if self.calls == 1:
                return response(original)
            if self.calls == 2:
                return response({"field_0": "또 \ufffd"})
            assert "output.field_0" in texts(kwargs) and DRAFT_MARKER in texts(kwargs)
            return response({"field_0": "원자료에서 해당 단어를 확인할 수 없습니다."})

    model = LectureModel(client=Client(), max_calls=3)
    result = model.generate(Study, "Study", {})
    assert "확인할 수 없습니다" in result.slideSummary and model.metrics()["modelCalls"] == 3


def test_repair_budget_and_truncation_guards_are_not_bypassed():
    original = study()
    original["slideSummary"] = "요약 \ufffd"

    class Client:
        def __init__(self, stop="tool_use"):
            self.requests, self.stop = [], stop

        def converse(self, **kwargs):
            self.requests.append(kwargs)
            return response(original, self.stop)

    client = Client()
    with pytest.raises(RuntimeError, match="model-call limit"):
        LectureModel(client=client, max_calls=1).generate(Study, "Study", {})
    assert len(client.requests) == 1
    truncated = Client("max_tokens")
    with pytest.raises(ValueError, match="cut off"):
        LectureModel(client=truncated, max_calls=3).generate(Study, "Study", {})
    assert all(schema_name(request) == "Study" for request in truncated.requests)


def test_damaged_keys_are_not_guessed_and_error_messages_do_not_quote_private_text():
    with pytest.raises(ValueError) as caught:
        validate_text_integrity({"mathNotes": [{"statement": "비공개 내용 \ufffd"}]})
    assert "output.mathNotes[0].statement" in str(caught.value)
    assert "비공개 내용" not in str(caught.value)
    original = study()
    original["slideSumm\ufffdary"] = original.pop("slideSummary")

    class Client:
        calls = 0

        def converse(self, **kwargs):
            self.calls += 1
            assert "\ufffd" not in texts(kwargs)
            if self.calls == 1:
                return response(original)
            assert "unreadable structured keys" in texts(kwargs)
            return response(study())

    assert LectureModel(client=Client(), max_calls=2).generate(Study, "Study", {}).slideSummary == study()["slideSummary"]
