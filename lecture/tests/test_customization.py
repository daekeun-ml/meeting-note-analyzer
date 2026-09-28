import copy

import pymupdf
import pytest
from PIL import Image

from lecture_study.customization import custom_prompt, request_cache_key, request_context
from lecture_study.pipeline import analyze
from lecture_study.prompts import STUDY_CACHE_VERSION
from lecture_study.schemas import Alignment, Audience, Overview, Papers, SlideReading, Study, VideoOutline
from lecture_study.study import generate_study
from test_pipeline import FakeModel, FakeSearch, FakeStore


def deck_store(tmp_path):
    path = tmp_path / "deck.pdf"
    with pymupdf.open() as doc:
        for number in range(2):
            doc.new_page().insert_text((30, 30), f"Gradient descent {number + 1}")
        doc.save(path)
    return FakeStore(path)


def run(store, model, tmp_path):
    work = tmp_path / "work"
    work.mkdir(exist_ok=True)
    search = FakeSearch()
    search.fail_second = False
    return analyze(store, work, lambda: None, model=model, search=search)


def test_absent_or_whitespace_request_keeps_default_inputs_and_existing_caches(tmp_path):
    store, model = deck_store(tmp_path), FakeModel()
    run(store, model, tmp_path)
    calls = list(model.calls)
    assert all("customPrompt" not in data for _, data in model.inputs)
    assert store.prefix + f"cache/study-1.{STUDY_CACHE_VERSION}.json" in store.values
    store.rec["customPrompt"] = " \n "
    run(store, model, tmp_path)
    assert model.calls == calls
    assert "customPrompt" not in store.values[store.prefix + "runs/run-1/document.json"]


def test_request_reaches_studies_paper_selection_and_overview_but_not_source_interpretation(tmp_path):
    store, model = deck_store(tmp_path), FakeModel()
    store.rec["customPrompt"] = "  첨부 슬라이드의 2페이지 위주로 보기  "
    run(store, model, tmp_path)
    for schema, data in model.inputs:
        if schema in (Study, Papers, Overview):
            assert data["customPrompt"] == "첨부 슬라이드의 2페이지 위주로 보기"
        if schema in (SlideReading, Alignment, Audience):
            assert "customPrompt" not in data
    studies = [data for schema, data in model.inputs if schema == Study]
    assert {s["requestScope"]["deckPage"] for s in studies} == {1, 2}
    assert all(s["requestScope"]["sourceType"] == "deck" for s in studies)
    overview = next(data for schema, data in model.inputs if schema == Overview)
    assert overview["requestScope"]["availableDeckPages"] == [1, 2]
    assert [p["deckPage"] for p in overview["pages"]] == [1, 2]
    document = store.values[store.prefix + "runs/run-1/document.json"]
    assert document["customPrompt"] == store.rec["customPrompt"].strip()
    assert len(document["pages"]) == 2  # Emphasis does not drop the other source pages.


def test_changed_request_regenerates_only_dependent_study_research_and_overview(tmp_path):
    store, model = deck_store(tmp_path), FakeModel()
    run(store, model, tmp_path)
    original = copy.deepcopy(store.values["transcript"])
    for prompt in ("2페이지 중심으로", "1페이지 중심으로"):
        store.rec["customPrompt"] = prompt
        offset = len(model.calls)
        run(store, model, tmp_path)
        assert sorted(schema.__name__ for schema in model.calls[offset:]) == ["Overview", "Papers", "Papers", "Study", "Study"]
        assert store.values["transcript"] == original
        offset = len(model.calls)
        run(store, model, tmp_path)
        assert len(model.calls) == offset
    store.rec["customPrompt"] = ""
    offset = len(model.calls)
    run(store, model, tmp_path)
    assert len(model.calls) == offset  # Reuse the untouched default variant again.


def test_audio_only_requests_do_not_gain_a_fictional_slide_page(tmp_path):
    store, model = FakeStore(None), FakeModel()
    store.rec["assets"] = {"audio": {"key": "lecture.mp3"}}
    store.rec["customPrompt"] = "기초부터 쉽게 설명해 주세요."
    run(store, model, tmp_path)
    study = next(data for schema, data in model.inputs if schema == Study)
    assert study["requestScope"]["sourceType"] == "audio"
    assert "deckPage" not in study["requestScope"]
    assert study["customPrompt"] == store.rec["customPrompt"]
    assert next(data for schema, data in model.inputs if schema == Overview)["requestScope"]["availableDeckPages"] == []


def test_video_deck_and_topic_requests_use_physical_deck_pages_and_actual_time_ranges(tmp_path):
    from test_video_pipeline import Model
    frame = tmp_path / "frame.jpg"
    Image.new("RGB", (64, 36)).save(frame)
    store = deck_store(tmp_path)
    store.rec["assets"]["video"] = {"key": "video.mp4"}
    store.rec["customPrompt"] = "첨부 슬라이드의 38–48페이지 위주로 보기"
    store.rec["videoManifestKey"] = "manifest"
    store.values["manifest"] = {"durationSec": 90, "sampleIntervalSec": 2, "sampledFrames": 6,
        "groupedScenes": False, "hasAudio": True, "scenes": [
            {"startSec": 0, "endSec": 30, "frameTimes": [0, 10, 20], "imageKeys": [store.prefix + "video/frames/0.jpg"] * 3},
            {"startSec": 30, "endSec": 90, "frameTimes": [30, 50, 80], "imageKeys": [store.prefix + "video/frames/1.jpg"] * 3},
        ]}
    download = store.download_file
    store.download_file = lambda bucket, key, dest: download(bucket, str(frame) if "/video/frames/" in key else key, dest)
    scopes = []
    class Inspect(Model):
        def generate(self, schema, task, data, **kwargs):
            if schema == Study:
                assert data["customPrompt"] == store.rec["customPrompt"]
                assert "physical order" in task and "Do not manufacture" in task
                scopes.append(data["requestScope"])
            return super().generate(schema, task, data, **kwargs)
    model = Inspect()
    run(store, model, tmp_path)
    assert [s["deckPage"] for s in scopes if s["sourceType"] == "deck"] == [1, 2]
    assert [s for s in scopes if s["sourceType"] == "video"] == [
        {"sourceType": "video", "videoRanges": [{"startSec": 30, "endSec": 90}]}]
    calls = list(model.calls)
    run(store, model, tmp_path)
    assert model.calls == calls


def test_long_speech_merges_keep_the_same_request_and_deck_page():
    model = FakeModel()
    base = {"outputLanguage": "ko", "reading": {"title": "Gradient"}, "sourceContext": {"pages": [{"page": 43}]},
            **request_context({"customPrompt": "38–48페이지 중심으로"}, sourceType="deck", deckPage=43)}
    speech = [{"segmentId": str(i), "text": "x" * 20_000} for i in range(3)]
    generate_study(model, "Study", base, speech)
    assert len(model.inputs) == 6  # Three chunks, two intermediate merges, then the final merge.
    assert all(data["customPrompt"] == "38–48페이지 중심으로" and data["requestScope"]["deckPage"] == 43 for _, data in model.inputs)


def test_optional_request_normalization_and_cache_keys():
    assert request_cache_key("overview.json", {}) == "overview.json"
    assert request_cache_key("overview.json", {"customPrompt": " \n"}) == "overview.json"
    one = request_cache_key("overview.json", {"customPrompt": "38–48페이지 중심"})
    assert one == request_cache_key("overview.json", {"customPrompt": " 38–48페이지 중심 "})
    assert one != request_cache_key("overview.json", {"customPrompt": "다른 요청"})
    with pytest.raises(ValueError):
        custom_prompt({"customPrompt": "가" * 2001})


def test_request_is_literal_text_in_markdown_export():
    from lecture_study.export import markdown
    result = markdown({"title": "T", "overview": "O", "learningObjectives": [], "reviewPlan": [], "pages": [], "warnings": [],
                       "customPrompt": "<script>x</script>\n![remote](https://example.org/image)"})
    assert "## 추가 요청" in result
    assert "<script>" not in result and "![remote]" not in result
