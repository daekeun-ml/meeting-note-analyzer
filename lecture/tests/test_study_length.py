import copy
import json

import pytest

from lecture_study.lecture_model import LectureModel
from lecture_study.model import Model
from lecture_study.schemas import Study
from lecture_study.study import generate_study, validate_references
from test_pipeline import FakeModel


def response(value):
    return {"stopReason": "tool_use", "usage": {"inputTokens": 10, "outputTokens": 5},
            "output": {"message": {"content": [{"toolUse": {"name": "deliver", "input": value}}]}}}


def draft():
    return copy.deepcopy({**FakeModel.STUDY, "searchQueries": []})


@pytest.mark.parametrize("profile,expected_model", [("balanced", "opus"), ("sonnet", "sonnet")])
def test_overlong_summary_is_repaired_without_regenerating_the_rest_of_the_study(profile, expected_model):
    original = draft()
    original["slideSummary"] = ("학습률은 곡률에 맞춰 조절합니다. " * 160) + r"원래 수식은 $\eta$입니다."
    snapshot = copy.deepcopy(original)
    fixed = r"학습률 $\eta$는 곡률에 맞춰 조절합니다."

    class Client:
        calls = []

        def converse(self, **kwargs):
            self.calls.append(kwargs)
            assert kwargs["modelId"] == expected_model
            schema = kwargs["toolConfig"]["tools"][0]["toolSpec"]["inputSchema"]["json"]
            if len(self.calls) == 1:
                assert schema["title"] == "Study"
                return response(original)
            assert schema["title"] == "StudyTextRepair"
            assert list(schema["properties"]) == ["slideSummary"]
            assert schema["properties"]["slideSummary"]["maxLength"] == 3000
            data = json.loads(kwargs["messages"][0]["content"][0]["text"].split("INPUT DATA:\n", 1)[1])
            assert data["fields"]["slideSummary"] == {"text": original["slideSummary"],
                                                     "characters": len(original["slideSummary"]), "limit": 3000, "target": 1800}
            return response({"slideSummary": fixed})

    client = Client()
    model = LectureModel(client=client, model_id="opus", fast_model_id="sonnet", preferences={"model": profile}, max_calls=2)
    result = model.generate(Study, "Study", {}).model_dump()
    assert result == Study.model_validate({**original, "slideSummary": fixed}).model_dump()
    assert original == snapshot
    assert model.metrics()["modelCalls"] == 2


def test_repair_normalizes_latex_before_measuring_length_and_does_not_bypass_references():
    original = draft()
    # Formatting expands an unmarked Greek letter to a complete LaTeX expression.
    original["slideSummary"] = " ".join(["η"] * 700)
    assert len(original["slideSummary"]) < 3000
    original["relatedPages"] = [{"page": 99, "topic": "Invented reference"}]

    class Client:
        titles = []

        def converse(self, **kwargs):
            schema = kwargs["toolConfig"]["tools"][0]["toolSpec"]["inputSchema"]["json"]
            self.titles.append(schema["title"])
            text = kwargs["messages"][0]["content"][0]["text"]
            if len(self.titles) == 1:
                return response(original)
            if schema["title"] == "StudyTextRepair":
                data = json.loads(text.split("INPUT DATA:\n", 1)[1])
                assert data["fields"]["slideSummary"]["characters"] > 3000
                return response({"slideSummary": r"학습률은 $\eta$입니다."})
            assert "supplied source pages" in kwargs["messages"][0]["content"][-1]["text"]
            assert "PREVIOUS INVALID" in kwargs["messages"][0]["content"][-2]["text"]
            return response(draft())

    client = Client()
    model = LectureModel(client=client, max_calls=3)
    result = model.generate(Study, "Study", {}, validate=lambda value: validate_references(value, {}))
    assert result.relatedPages == []
    assert client.titles == ["Study", "StudyTextRepair", "Study"]


def test_multiple_overlong_fields_are_repaired_together_under_the_same_call_budget():
    original = draft()
    original.update(slideSummary="요약 " * 1200, spokenSummary="발언 " * 1800, explanation="설명 " * 1800)

    class Client:
        calls = 0

        def converse(self, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return response(original)
            schema = kwargs["toolConfig"]["tools"][0]["toolSpec"]["inputSchema"]["json"]
            assert set(schema["properties"]) == {"slideSummary", "spokenSummary", "explanation"}
            return response({"slideSummary": "요약", "spokenSummary": "발언", "explanation": "설명"})

    client = Client()
    with pytest.raises(RuntimeError, match="model-call limit"):
        LectureModel(client=client, max_calls=1).generate(Study, "Study", {})
    assert client.calls == 1  # A field repair cannot make an uncounted call.
    client = Client()
    result = LectureModel(client=client, max_calls=2).generate(Study, "Study", {})
    assert result.slideSummary == "요약" and result.explanation == "설명" and client.calls == 2


def test_length_retry_reports_measured_characters_without_exposing_draft_in_job_errors():
    original = draft()
    original["slideSummary"] = "개인정보가 포함될 수 있는 비공개 발언 " * 150

    class Client:
        requests = []

        def converse(self, **kwargs):
            self.requests.append(kwargs)
            return response(original)

    client = Client()
    with pytest.raises(ValueError, match="currently") as caught:
        Model(client=client).generate(Study, "Study", {})
    assert f"currently {len(original['slideSummary'])} Unicode characters" in str(caught.value)
    assert "비공개 발언" not in str(caught.value)
    assert "1800 characters" in client.requests[1]["messages"][0]["content"][-1]["text"]


def test_generation_and_consolidation_receive_the_same_character_targets():
    class Model(FakeModel):
        def generate(self, schema, task, data, **kwargs):
            if schema is Study:
                assert "CHARACTER" in task and "hard maximum 3,000" in task
                assert "Consolidation of partial notes" in task
            return super().generate(schema, task, data, **kwargs)

    model = Model()
    evidence = [{"text": "내용" * 10_000}, {"text": "추가" * 10_000}]
    result = generate_study(model, "Study", {"reading": {}}, evidence)
    assert result["slideSummary"] == FakeModel.STUDY["slideSummary"]
    assert model.calls.count(Study) == 3  # Two batches, followed by consolidation.
