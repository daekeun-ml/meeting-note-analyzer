from copy import deepcopy

import pytest

from meeting_agents.attribution import reconcile_attribution
from meeting_agents.schemas import validate
from meeting_agents.transcript import Transcript


def transcript():
    rows = [("S1", "저는 김민수입니다."), ("S2", "저는 이지수입니다."),
            ("S1", "이지수입니다. 일정을 확인하겠습니다."), ("S1", "다음 안건을 보겠습니다."),
            ("S3", "김민수입니다. 제가 다시 설명하겠습니다.")]
    return {"meetingId": "m1", "durationSec": 50, "language": "ko", "speakers": [], "segments": [
        {"id": f"seg-{i}", "speaker": speaker, "start": i * 10, "end": i * 10 + 5,
         "text": text, "words": [{"w": text, "s": i * 10, "e": i * 10 + 5, "p": 0.9}]}
        for i, (speaker, text) in enumerate(rows)
    ]}


def evidence(*indices):
    return [{"segmentId": f"seg-{i}", "quote": transcript()["segments"][i]["text"]} for i in indices]


def decision(*indices):
    return {"decision": "confirmed", "basis": "explicit_identity", "confidence": 0.95, "support": evidence(*indices)}


def relabel(**overrides):
    return {**decision(1, 2), "segmentId": "seg-2", "from": "S1", "to": "S2", "reason": "두 발언에서 이지수라고 소개함", **overrides}


def merge(**overrides):
    return {**decision(0, 4), "from": ["S3"], "to": "S1", "reason": "두 라벨에서 같은 이름으로 소개함", **overrides}


def reconcile(t=None, **draft):
    return reconcile_attribution(t or transcript(), validate("speaker_attribution", {"speakers": [], **draft}))


def test_relabel_with_direct_evidence_preserves_words_times_and_original():
    original = transcript()
    before = deepcopy(original)
    safe, out = reconcile(original, relabels=[relabel()])
    assert original == before
    assert out["segments"][2]["speaker"] == "S2"
    assert out["segments"][2]["originalSpeaker"] == "S1"
    assert out["segments"][2]["speakerReviewRequired"] is False
    assert len(safe["relabels"]) == 1 and not safe["reviewItems"]
    for old, new in zip(original["segments"], out["segments"], strict=True):
        for key in ("id", "start", "end", "text", "words"):
            assert new[key] == old[key]


def test_merge_has_checked_evidence_for_both_speakers_and_recomputes_stats():
    safe, out = reconcile(merges=[merge()], speakers=[
        {"id": "S1", "label": "김민수", "name": "김민수", "evidence": [], **decision(0)},
    ])
    assert out["segments"][4]["speaker"] == "S1"
    assert out["segments"][4]["speakerLabel"] == "김민수"
    assert {s["id"] for s in safe["speakers"]} == {"S1", "S2"}
    assert out["speakers"][0]["talkTimeSec"] == 20
    assert not safe["reviewItems"]


@pytest.mark.parametrize(("overrides", "issue"), [
    ({"basis": "context"}, "context_only"),
    ({"decision": "review_required"}, "unconfirmed"),
    ({"confidence": 0.8}, "low_confidence"),
    ({"support": []}, "missing_evidence"),
    ({"support": [{"segmentId": "seg-2", "quote": "없는 인용"}]}, "invalid_evidence"),
    ({"support": evidence(1)}, "missing_segment_evidence"),
    ({"support": evidence(2)}, "missing_evidence"),
    ({"from": "S3"}, "source_mismatch"),
    ({"to": "S9"}, "invalid_speaker"),
    ({"segmentId": "missing"}, "invalid_segment"),
])
def test_uncertain_or_invalid_relabel_never_changes_identity(overrides, issue):
    safe, out = reconcile(relabels=[relabel(**overrides)])
    assert not safe["relabels"]
    assert [s["speaker"] for s in out["segments"]] == [s["speaker"] for s in transcript()["segments"]]
    assert issue in safe["reviewItems"][0]["issues"]
    if overrides.get("segmentId") != "missing":
        assert out["segments"][2]["speakerReviewRequired"] is True


def test_blank_whitespace_quotes_are_not_evidence():
    safe, _ = reconcile(relabels=[relabel(support=[{"segmentId": "seg-2", "quote": " \n "}])])
    assert "invalid_evidence" in safe["reviewItems"][0]["issues"]


def test_source_quotes_preserve_punctuation_and_allow_whitespace_alignment():
    t = transcript()
    t["segments"][2]["text"] = "이지수입니다.\n일정을 확인하겠습니다."
    safe, _ = reconcile(t, relabels=[relabel()])
    assert safe["relabels"] and not safe["reviewItems"]


def test_conflicting_relabels_are_both_reviewed():
    safe, out = reconcile(relabels=[relabel(), relabel(to="S3")])
    assert not safe["relabels"] and len(safe["reviewItems"]) == 2
    assert out["segments"][2]["speaker"] == "S1"


@pytest.mark.parametrize("merges", [
    [merge(), merge(**{"from": ["S1"], "to": "S3"})],  # cycle
    [merge(), merge(**{"from": ["S1"], "to": "S2"})],  # chain
    [merge(), merge(**{"from": ["S2"], "to": "S1"})],  # shared target
    [merge(**{"from": ["S3", "S3"]})],  # duplicate source
])
def test_intersecting_merges_do_not_depend_on_order(merges):
    for proposals in (merges, list(reversed(merges))):
        safe, _ = reconcile(merges=proposals)
        assert not safe["merges"]
        assert all("conflicting_proposals" in c["issues"] for c in safe["reviewItems"])


def test_merge_and_relabel_of_same_speaker_are_reviewed_together():
    safe, _ = reconcile(merges=[merge()], relabels=[relabel()])
    assert not safe["merges"] and not safe["relabels"]
    assert all("conflicting_proposals" in c["issues"] for c in safe["reviewItems"])


def test_simultaneous_speech_blocks_a_merge():
    t = transcript()
    t["segments"][4].update(start=1, end=4)
    safe, _ = reconcile(t, merges=[merge()])
    assert not safe["merges"]
    assert "overlapping_speech" in safe["reviewItems"][0]["issues"]


def test_unsupported_names_remain_candidates_and_do_not_reach_downstream_as_facts():
    safe, out = reconcile(speakers=[{"id": "S1", "label": "진행자", "role": "진행자", "confidence": 0.99}])
    speaker = next(s for s in safe["speakers"] if s["id"] == "S1")
    assert speaker["label"] == "S1" and "role" not in speaker
    assert speaker["proposedLabel"] == "진행자" and speaker["reviewRequired"]
    assert safe["reviewItems"][0]["kind"] == "label" and safe["reviewItems"][0]["segmentIds"] == []
    assert all(not s["speakerReviewRequired"] for s in out["segments"])  # a name review never flags the utterances themselves
    assert "speaker review required" not in Transcript(out).to_markdown("회의")


def test_neutral_label_with_a_name_is_reviewed_as_that_name():
    safe, out = reconcile(speakers=[{"id": "S2", "label": "S2", "name": "이지수", "confidence": 0.9, **decision(1)}])
    speaker = next(s for s in safe["speakers"] if s["id"] == "S2")
    assert speaker["label"] == "이지수" and not speaker["reviewRequired"]
    safe, _ = reconcile(speakers=[{"id": "S2", "label": "S2", "name": "이지수", "confidence": 0.5}])
    speaker = next(s for s in safe["speakers"] if s["id"] == "S2")
    assert speaker["label"] == "S2" and speaker["proposedLabel"] == "이지수" and speaker["reviewRequired"]


def test_anonymous_and_missing_speakers_remain_valid_without_forced_guesses():
    safe, out = reconcile(speakers=[{"id": "S1", "label": "화자 1", "confidence": 0}])
    assert not safe["reviewItems"]
    assert {s["id"] for s in safe["speakers"]} == {"S1", "S2", "S3"}
    assert all(not s["speakerReviewRequired"] for s in out["segments"])


def test_invented_and_duplicate_speaker_names_are_reported():
    safe, _ = reconcile(speakers=[
        {"id": "S1", "label": "김민수", **decision(0)},
        {"id": "S2", "label": "김민수", **decision(1)},
        {"id": "S9", "label": "없는 화자", **decision(0)},
    ])
    assert all(s["label"] == s["id"] for s in safe["speakers"])
    assert safe["reviewItems"][-1]["issues"] == ["invalid_speaker"]
    assert safe["reviewItems"][-1]["segmentIds"] == []


def test_neutral_labels_with_identical_names_are_reviewed_before_confirmation():
    safe, _ = reconcile(speakers=[
        {"id": "S1", "label": "S1", "name": "동일 이름", **decision(0)},
        {"id": "S2", "label": "화자 2", "name": "동일 이름", **decision(1)},
    ])
    for speaker in safe["speakers"]:
        if speaker["id"] in ("S1", "S2"):
            assert speaker["reviewRequired"] and speaker["label"] == speaker["id"]
    assert all("ambiguous_identity" in item["issues"] for item in safe["reviewItems"])


def test_neutral_label_and_named_label_use_the_same_duplicate_comparison():
    safe, _ = reconcile(speakers=[
        {"id": "S1", "label": "S1", "name": "동일 이름", **decision(0)},
        {"id": "S2", "label": "동일 이름", **decision(1)},
    ])
    assert len(safe["reviewItems"]) == 2
    assert all("ambiguous_identity" in item["issues"] for item in safe["reviewItems"])
