import json
import threading

import pytest
from botocore.exceptions import ClientError

from lecture_study.deck_scope import DeckPlan, DeckScope
from lecture_study.lecture_model import LectureModel
from lecture_study.model import Model
from lecture_study.parallel import parallel_map
from lecture_study.pipeline import analyze
from lecture_study.schemas import Alignment, Audience, Overview, Papers, SlideReading, Study, VideoMatch, VideoObservation, VideoOutline
from test_pipeline import FakeModel, FakeSearch, FakeStore
from test_study_profile import make_deck


def response(value):
    return {"stopReason": "tool_use", "usage": {"inputTokens": 3, "outputTokens": 1},
            "output": {"message": {"content": [{"toolUse": {"name": "deliver", "input": value}}]}}}


class Client:
    def __init__(self):
        self.requests = []
        self.fake = FakeModel()

    def converse(self, **kwargs):
        self.requests.append(kwargs)
        schemas = (DeckPlan, DeckScope, Alignment, Audience, Overview, Papers, SlideReading, Study, VideoMatch, VideoObservation, VideoOutline)
        name = kwargs["toolConfig"]["tools"][0]["toolSpec"]["inputSchema"]["json"]["title"]
        schema = next(s for s in schemas if s.__name__ == name)
        data = json.loads(kwargs["messages"][0]["content"][0]["text"].split("INPUT DATA:\n", 1)[1])
        return response(self.fake.generate(schema, "", data).model_dump())


def test_full_deck_pipeline_routes_extraction_to_sonnet_and_reasoning_to_opus_and_invalidates_old_cache(tmp_path):
    store, search = FakeStore(make_deck(tmp_path, pages=1)), FakeSearch()
    work = tmp_path / "work"; work.mkdir()
    # Populate valid legacy Sonnet results, including a summary that must be refreshed.
    analyze(store, work, lambda: None, model=FakeModel(), search=search)
    client = Client()
    model = LectureModel(client=client, model_id="opus", fast_model_id="sonnet")
    analyze(store, work, lambda: None, model=model, search=search)
    routes = {r["toolConfig"]["tools"][0]["toolSpec"]["inputSchema"]["json"]["title"]: r["modelId"] for r in client.requests}
    assert routes == {"SlideReading": "sonnet", "Papers": "sonnet", "DeckPlan": "opus", "Alignment": "opus",
                      "Audience": "opus", "Study": "opus", "Overview": "opus"}
    assert len(client.requests) == 7
    analyze(store, work, lambda: None, model=model, search=search)
    assert len(client.requests) == 7  # Same policy resumes cached work.
    for primary, fast in (("new-opus", "sonnet"), ("new-opus", "new-sonnet")):
        other = Client()
        analyze(store, work, lambda: None, model=LectureModel(client=other, model_id=primary, fast_model_id=fast), search=search)
        assert len(other.requests) == 7
    assert store.values["transcript"]["segments"][0]["text"] == "We update the weights using the gradient."


def test_model_profiles_can_be_overridden_without_affecting_interview_routing(monkeypatch):
    monkeypatch.setenv("LECTURE_MODEL", "configured-opus")
    monkeypatch.setenv("LECTURE_FAST_MODEL", "configured-sonnet")
    client = Client()
    lecture = LectureModel(client=client)
    lecture.generate(Papers, "select", {})
    lecture.generate(Overview, "summarize", {})
    interview = Model(client=client, model_id="interview-opus")
    interview.generate(Papers, "same schema still uses explicit interview model", {})
    assert [r["modelId"] for r in client.requests] == ["configured-sonnet", "configured-opus", "interview-opus"]


def test_parallel_routes_share_one_cap_and_never_overwrite_each_others_model():
    class ParallelClient:
        def __init__(self): self.calls = []; self.lock = threading.Lock()
        def converse(self, **kwargs):
            schema = kwargs["toolConfig"]["tools"][0]["toolSpec"]["inputSchema"]["json"]["title"]
            with self.lock: self.calls.append((schema, kwargs["modelId"]))
            return response({"papers": []} if schema == "Papers" else {"assignments": []})
    client = ParallelClient()
    model = LectureModel(client=client, model_id="opus", fast_model_id="sonnet", max_calls=40)
    parallel_map(range(40), lambda i: model.generate(Papers if i % 2 else Alignment, "task", {}), check=lambda: None)
    assert client.calls.count(("Papers", "sonnet")) == client.calls.count(("Alignment", "opus")) == 20
    assert model.metrics() == {"modelCalls": 40, "modelCallLimit": 40, "inputTokens": 120, "outputTokens": 40}
    with pytest.raises(RuntimeError, match="limit"):
        model.generate(Papers, "over cap", {})
    assert len(client.calls) == 40


def test_retry_and_output_repair_keep_the_route_and_share_the_call_budget(monkeypatch):
    monkeypatch.setattr("lecture_study.model.time.sleep", lambda _: None)
    class RepairClient:
        def __init__(self): self.ids = []
        def converse(self, **kwargs):
            self.ids.append(kwargs["modelId"])
            if len(self.ids) == 1:
                raise ClientError({"Error": {"Code": "ThrottlingException"}}, "Converse")
            text = "Unreadable \ufffd" if len(self.ids) == 2 else r"첫 문단에서 강의 내용을 설명합니다.\n\n수식 \\arg\\max_\\theta \\sum_t x_t으로 정리합니다."
            return response({"overview": text, "learningObjectives": ["목표"], "reviewPlan": ["복습"]})
    client = RepairClient()
    model = LectureModel(client=client, model_id="opus", fast_model_id="sonnet", max_calls=3)
    result = model.generate(Overview, "overview", {})
    assert client.ids == ["opus"] * 3
    assert "\n\n" in result.overview and r"$\arg\max_\theta \sum_t x_t$" in result.overview
    assert "\ufffd" not in result.overview


@pytest.mark.parametrize("choice,expected", [("balanced", ["sonnet", "opus"]), ("opus", ["opus", "opus"]), ("sonnet", ["sonnet", "sonnet"])])
def test_account_model_choice_controls_real_requests_and_never_accepts_arbitrary_profiles(choice, expected):
    client = Client()
    model = LectureModel(client=client, model_id="opus", fast_model_id="sonnet", preferences={"model": choice})
    model.generate(Papers, "select papers", {})
    model.generate(Overview, "overview", {})
    assert [request["modelId"] for request in client.requests] == expected
    with pytest.raises(ValueError):
        LectureModel(client=client, preferences={"model": "unapproved-profile"})


def test_style_defaults_reach_study_generation_and_invalidate_cached_outputs():
    client = Client()
    model = LectureModel(client=client, model_id="opus", fast_model_id="sonnet",
                         preferences={"format": "narrative", "tone": "friendly", "detail": "detailed"})
    model.generate(Overview, "overview", {"customPrompt": "이 강의는 짧게"})
    request = client.requests[0]["messages"][0]["content"][0]["text"]
    assert "connected short paragraphs" in request and "warmly" in request
    assert "overrides these style defaults" in request and "LaTeX" in request
    default = LectureModel(client=client, model_id="opus", fast_model_id="sonnet")
    assert model.cache_namespace != default.cache_namespace
