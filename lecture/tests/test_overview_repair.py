import copy
import json

import pytest

from lecture_study.lecture_model import LectureModel
from lecture_study.schemas import Overview


def response(value):
    return {"stopReason": "tool_use", "usage": {"inputTokens": 10, "outputTokens": 5},
            "output": {"message": {"content": [{"toolUse": {"name": "deliver", "input": value}}]}}}


def valid():
    return {"overview": "이 강의는 학습 과정과 일반화의 관계를 설명하고 각 설계의 이유를 살펴봅니다.",
            "learningObjectives": ["학습률과 수렴의 관계를 설명한다."],
            "reviewPlan": ["학습률 변화에 따른 손실을 비교한다.", "일반화의 한계를 정리한다."]}


class Client:
    def __init__(self, values):
        self.values, self.requests = iter(values), []

    def converse(self, **kwargs):
        self.requests.append(kwargs)
        return response(next(self.values))


def schema(request):
    return request["toolConfig"]["tools"][0]["toolSpec"]["inputSchema"]["json"]


def data(request):
    return json.loads(request["messages"][0]["content"][0]["text"].split("INPUT DATA:\n", 1)[1])


@pytest.mark.parametrize("profile,route", [("balanced", "opus"), ("sonnet", "sonnet")])
def test_overview_repairs_reported_length_and_both_list_types_in_one_bounded_patch(profile, route):
    original = {"overview": "강의의 핵심을 설명하는 문장입니다. " * 500,
                "learningObjectives": "- 학습률을 설명한다.\n- 일반화의 한계를 설명한다.",
                "reviewPlan": {"steps": ["학습률 변화에 따른 손실을 비교한다."]}}
    snapshot = copy.deepcopy(original)
    source = {"outputLanguage": "ko", "pages": [{"summary": "학습률과 일반화의 관계"}]}
    client = Client([original, valid()])
    model = LectureModel(client=client, model_id="opus", fast_model_id="sonnet",
                         preferences={"model": profile}, max_calls=2)
    result = model.generate(Overview, "Whole lecture", source)
    assert result.model_dump() == valid() and original == snapshot
    first, repair = client.requests
    assert [r["modelId"] for r in client.requests] == [route, route]
    assert schema(repair)["title"] == "OverviewRepair"
    assert set(schema(repair)["properties"]) == set(valid())
    assert schema(repair)["properties"]["overview"]["maxLength"] == 5000
    assert schema(repair)["properties"]["reviewPlan"]["maxItems"] == 15
    assert data(repair)["source"] == source
    assert data(repair)["fields"]["overview"]["characters"] == len(original["overview"])
    assert data(repair)["fields"]["overview"]["target"] == 3000
    assert "ARRAY OF STRINGS" in first["messages"][0]["content"][0]["text"]
    assert model.metrics()["modelCalls"] == 2


def test_length_patch_preserves_valid_lists_and_does_not_truncate_original_text():
    original = valid()
    original["overview"] = ("학습률을 조절하는 이유를 설명합니다. " * 300) + r"단, $\eta > 0$이라는 조건이 필요합니다."
    fixed = valid()["overview"] + r" 단, $\eta > 0$이라는 조건이 필요합니다."
    client = Client([original, {"overview": fixed}])
    result = LectureModel(client=client, max_calls=2).generate(Overview, "Summarize", {}).model_dump()
    assert set(schema(client.requests[1])["properties"]) == {"overview"}
    assert data(client.requests[1])["fields"]["overview"]["draft"] == original["overview"]
    assert result == {**original, "overview": fixed}


def test_json_encoded_lists_are_decoded_losslessly_before_math_and_unicode_normalization():
    original = valid()
    original["learningObjectives"] = [r"$\eta$의 역할을 설명한다.", '용어 "학습률"을 정의한다.']
    encoded = {**original, "learningObjectives": json.dumps(original["learningObjectives"], ensure_ascii=False),
               "reviewPlan": json.dumps(original["reviewPlan"], ensure_ascii=False)}
    client = Client([encoded])
    result = LectureModel(client=client, max_calls=1).generate(Overview, "Summarize", {})
    assert result.model_dump() == original and len(client.requests) == 1
    assert isinstance(encoded["reviewPlan"], str)


@pytest.mark.parametrize("malformed", [None, [], ["valid", 42], '{"step": "Review"}', '["Review", 42]',
                                      ["Step"] * 16, "- First step\n- Second step"])
def test_invalid_list_requires_schema_repair_instead_of_silent_dropping_or_coercion(malformed):
    original = {**valid(), "reviewPlan": malformed}
    client = Client([original, {"reviewPlan": valid()["reviewPlan"]}])
    result = LectureModel(client=client, max_calls=2).generate(Overview, "Summarize", {})
    assert result.model_dump() == valid()
    assert set(schema(client.requests[1])["properties"]) == {"reviewPlan"}
    assert data(client.requests[1])["fields"]["reviewPlan"]["draft"] == malformed


def test_invalid_patch_gets_actionable_bounded_retry_without_regenerating_valid_overview():
    original = {**valid(), "reviewPlan": "Compare the losses."}
    client = Client([original, {"reviewPlan": "Still a string"}, {"reviewPlan": valid()["reviewPlan"]}])
    model = LectureModel(client=client, max_calls=3)
    assert model.generate(Overview, "Summarize", {}).model_dump() == valid()
    assert [schema(r)["title"] for r in client.requests] == ["Overview", "OverviewRepair", "OverviewRepair"]
    assert "real JSON array" in client.requests[2]["messages"][0]["content"][-1]["text"]
    assert "PREVIOUS INVALID" in client.requests[2]["messages"][0]["content"][-2]["text"]


def test_overview_repairs_share_call_cap_and_valid_output_needs_no_patch():
    client = Client([{**valid(), "overview": "설명" * 6000}])
    with pytest.raises(RuntimeError, match="model-call limit"):
        LectureModel(client=client, max_calls=1).generate(Overview, "Summarize", {})
    assert len(client.requests) == 1
    client = Client([valid()])
    assert LectureModel(client=client, max_calls=1).generate(Overview, "Summarize", {}).model_dump() == valid()
    assert len(client.requests) == 1


def test_repaired_overview_still_runs_full_validation():
    client = Client([{**valid(), "reviewPlan": "Bad type"}, {"reviewPlan": valid()["reviewPlan"]}])
    seen = []
    result = LectureModel(client=client, max_calls=2).generate(
        Overview, "Summarize", {}, validate=lambda value: seen.append(value.model_dump()))
    assert seen == [result.model_dump()]
