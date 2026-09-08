import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError

from meeting_agents import runner
from meeting_agents.payload import StagePayload
from meeting_agents.stages import SPECS
from meeting_agents.transcript import Transcript


def test_runtime_publishes_only_accepted_proposals_and_keeps_review_evidence(monkeypatch, tmp_path):
    source = {"meetingId": "m1", "durationSec": 20, "speakers": [{"id": "S1"}, {"id": "S2"}], "segments": [
        {"id": "seg-1", "speaker": "S1", "start": 0, "end": 5, "text": "질문하겠습니다.", "words": []},
        {"id": "seg-2", "speaker": "S2", "start": 10, "end": 15, "text": "답변하겠습니다.", "words": []},
    ]}
    draft = {"speakers": [{"id": "S1", "label": "S1", "confidence": 0}, {"id": "S2", "label": "S2", "confidence": 0}],
             "relabels": [{"segmentId": "seg-1", "from": "S1", "to": "S2", "confidence": 0.99,
                           "basis": "context", "decision": "confirmed", "reason": "문맥 추정",
                           "support": [{"segmentId": "seg-1", "quote": "질문하겠습니다."}]}]}
    storage = Mock()
    monkeypatch.setattr(runner.boto3, "client", lambda *args, **kwargs: storage)
    monkeypatch.setattr(runner, "TABLE_NAME", "")
    monkeypatch.setattr(runner, "prepare_workdir", lambda *args: (tmp_path, Transcript(source)))
    monkeypatch.setattr(runner, "build_server", lambda **kwargs: None)
    monkeypatch.setattr(runner, "build_options", lambda *args: None)
    monkeypatch.setattr(runner, "_query_with_retry", lambda *args: (draft, SimpleNamespace()))
    monkeypatch.setattr(runner.memory, "record_stage_note", lambda *args: None)
    runner.run_stage(StagePayload(stage="speaker_attribution", meetingId="m1", ownerSub="u1", transcriptKey="source"))
    outputs = {c.kwargs["Key"]: json.loads(c.kwargs["Body"]) for c in storage.put_object.call_args_list}
    stage = outputs["results/m1/speaker_attribution.json"]
    attributed = outputs["results/m1/transcript_attributed.json"]
    assert stage["relabels"] == [] and len(stage["reviewItems"]) == 1
    assert attributed["segments"][0]["speaker"] == "S1"
    assert attributed["segments"][0]["speakerReviewRequired"]
    assert "source" not in outputs


@pytest.mark.parametrize("code", [None, "404", "AccessDenied", "SlowDown"])
def test_downstream_reads_corrected_transcript_or_reports_storage_failure(monkeypatch, tmp_path, code):
    downloads = []
    t = {"durationSec": 5, "speakers": [{"id": "S1"}], "segments": [
        {"id": "seg-1", "speaker": "S1", "speakerLabel": "확인된 이름", "speakerReviewRequired": True,
         "start": 0, "end": 5, "text": "발언", "words": []},
    ]}

    class Storage:
        def head_object(self, **kwargs):
            if code:
                raise ClientError({"Error": {"Code": code}}, "HeadObject")

        def download_file(self, bucket, key, destination):
            downloads.append(key)
            Path(destination).write_text(json.dumps(t if destination.endswith("transcript.json") else {}), encoding="utf-8")

    monkeypatch.setattr(runner, "WORK_ROOT", tmp_path)
    payload = StagePayload(stage="summary", meetingId="m1", ownerSub="u1", transcriptKey="original")
    if code in ("AccessDenied", "SlowDown"):
        with pytest.raises(ClientError):
            runner.prepare_workdir(Storage(), payload, SPECS["summary"])
        assert downloads == []
    else:
        workdir, _ = runner.prepare_workdir(Storage(), payload, SPECS["summary"])
        assert downloads[0] == ("original" if code == "404" else "results/m1/transcript_attributed.json")
        assert "확인된 이름" in (workdir / "transcript.md").read_text()
        assert "speaker review required" in (workdir / "transcript.md").read_text()
