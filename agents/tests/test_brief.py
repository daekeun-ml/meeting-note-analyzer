from copy import deepcopy

import pytest
from pydantic import ValidationError

from meeting_agents import brief
from meeting_agents.schemas import validate


PRIOR = {
    "agenda": {"items": [{"id": "A1", "decisions": ["핵심 기능부터 출시", "통계 기능은 다음 버전"], "openQuestions": ["출시일 확정"]}]},
    "follow_ups": {"items": [{"id": "F1", "title": "업로드 테스트", "ownerName": "수정된 이름", "dueHint": "금요일"}]},
}
SEGMENTS = [{"id": "seg-0001", "start": 63, "speaker": "S1", "text": "테스트 기간이 부족해서 검색·업로드부터 먼저 내죠."}]


def draft():
    return {"headline": "핵심 기능부터 우선 출시하기로 결정", "decisions": [{"agendaId": "A1", "decisionIndex": 0, "process": "테스트 기간이 부족해 핵심 기능을 먼저 출시하기로 했다.", "rationaleStatus": "supported", "evidenceSegmentIds": ["seg-0001"]}], "followUpIds": ["F1"], "openQuestions": [{"agendaId": "A1", "questionIndex": 0}]}


def test_resolves_decisions_and_verbatim_evidence_from_sources():
    raw = draft()
    out = brief.resolve(validate("meeting_brief", raw), PRIOR, SEGMENTS)
    assert out["decisions"][0]["decision"] == "핵심 기능부터 출시"
    assert out["decisions"][0]["evidence"][0] == {"segmentId": "seg-0001", "start": 63, "speaker": "S1", "text": SEGMENTS[0]["text"]}
    assert out["openQuestions"][0]["question"] == "출시일 확정"
    assert out["omittedCounts"] == {"decisions": 1, "followUps": 0, "openQuestions": 0}
    assert "decision" not in raw["decisions"][0]


@pytest.mark.parametrize("change", [
    lambda d: d["decisions"][0].update(agendaId="invented"),
    lambda d: d["decisions"][0].update(decisionIndex=5),
    lambda d: d["decisions"][0].update(evidenceSegmentIds=["invented"]),
    lambda d: d["decisions"][0].update(evidenceSegmentIds=[]),
    lambda d: d["decisions"][0].update(process="  "),
    lambda d: d["decisions"].append(deepcopy(d["decisions"][0])),
    lambda d: d.update(followUpIds=["invented"]),
    lambda d: d.update(followUpIds=["F1", "F1"]),
    lambda d: d["openQuestions"][0].update(questionIndex=2),
    lambda d: d.update(decisions=[]),
])
def test_rejects_bad_or_missing_references(change):
    raw = draft()
    change(raw)
    with pytest.raises(ValueError):
        brief.resolve(raw, PRIOR, SEGMENTS)


def test_missing_reason_cannot_keep_an_invented_process():
    raw = draft()
    raw["decisions"][0].update(rationaleStatus="not_recorded", evidenceSegmentIds=[], process="상상한 만장일치 이유")
    assert brief.resolve(raw, PRIOR, SEGMENTS)["decisions"][0]["process"] == ""


def test_discussion_without_decisions_or_tasks_does_not_need_filler():
    raw = {"headline": "출시 범위를 논의했지만 합의에 이르지 못했다.", "decisions": [], "followUpIds": [], "openQuestions": []}
    out = brief.resolve(validate("meeting_brief", raw), {"agenda": {"items": []}, "follow_ups": {"items": []}}, [])
    assert out["decisions"] == []
    assert out["omittedCounts"] == {"decisions": 0, "followUps": 0, "openQuestions": 0}


def test_schema_bounds_keep_the_recap_short():
    raw = draft()
    raw["decisions"] *= 4
    with pytest.raises(ValidationError):
        validate("meeting_brief", raw)
    raw = draft()
    raw["headline"] = "가" * 181
    with pytest.raises(ValidationError):
        validate("meeting_brief", raw)


def test_published_priors_preserve_updated_content():
    doc = {"agenda": PRIOR["agenda"]["items"], "summary": {"headline": "완성된 결론"}, "notes": {"markdown": "상세 기록"}, "followUps": PRIOR["follow_ups"]["items"], "speakers": [{"id": "S1", "label": "수정된 이름"}]}
    inputs = brief.published_priors(doc)
    assert inputs["follow_ups"]["items"][0]["ownerName"] == "수정된 이름"
    assert inputs["speaker_attribution"]["speakers"] == doc["speakers"]


def test_backfill_workdir_uses_current_document_without_old_stage_files(monkeypatch, tmp_path):
    import json
    from pathlib import Path
    from meeting_agents import runner
    from meeting_agents.payload import StagePayload
    from meeting_agents.stages import SPECS

    doc = {"meetingId": "m1", "agenda": PRIOR["agenda"]["items"], "summary": {"headline": "완성된 결론"}, "notes": {"markdown": "상세 기록"}, "followUps": PRIOR["follow_ups"]["items"], "speakers": [{"id": "S1", "label": "수정된 이름"}]}
    files = {"transcripts/m1/transcript.json": {"durationSec": 100, "speakers": [], "segments": SEGMENTS}, "results/m1/document.json": doc}
    downloads = []

    class FakeS3:
        def head_object(self, **kwargs):
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")

        def download_file(self, bucket, key, destination):
            downloads.append(key)
            Path(destination).write_text(json.dumps(files[key]), encoding="utf-8")

    monkeypatch.setattr(runner, "WORK_ROOT", tmp_path)
    payload = StagePayload(stage="meeting_brief", meetingId="m1", ownerSub="u1", transcriptKey="transcripts/m1/transcript.json", documentKey="results/m1/document.json")
    workdir, transcript = runner.prepare_workdir(FakeS3(), payload, SPECS["meeting_brief"])
    assert downloads == list(files)
    text = (workdir / "prior" / "follow_ups.json").read_text(encoding="utf-8")
    assert "\n" in text and "수정된 이름" in text
    assert transcript.segments == SEGMENTS
