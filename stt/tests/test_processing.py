import copy
import json
from pathlib import Path
from botocore.exceptions import ClientError
import pytest

from stt.processing import process_transcript
from stt.schemas import Segment, Speaker, SttRequest, SttResponse, Word
from stt.scope import Boundary, ScopeProposal, choose_scope, resolve_scope
from stt.terminology import correct_terms, dictionary


def speech():
    return [
        Segment(id="s1", start=0, end=10, speaker="S1", text="점심은 어디서 먹을까요?"),
        Segment(id="s2", start=10, end=20, speaker="S2", text="어제 본 영화가 재미있었어요."),
        Segment(id="s3", start=20, end=30, speaker="S1", text="그럼 회의를 시작하겠습니다. 오늘 안건은 저장소입니다."),
        Segment(id="s4", start=30, end=160, speaker="S2", text="에스쓰리에 백업하고 다이나모 디비를 사용했습니다."),
        Segment(id="s5", start=160, end=180, speaker="S1", text="오늘 회의는 여기까지 하겠습니다."),
        Segment(id="s6", start=180, end=200, speaker="S2", text="주말에는 영화를 보려고 해요."),
    ]


def proposal():
    return ScopeProposal(
        leading=Boundary(exclude=True, retainedSegmentId="s3", quote="그럼 회의를 시작하겠습니다.", confidence=.99, reason="시작 전 식사와 영화 잡담"),
        trailing=Boundary(exclude=True, retainedSegmentId="s5", quote="오늘 회의는 여기까지 하겠습니다.", confidence=.99, reason="종료 후 개인적인 잡담"),
    )


def test_only_verified_edge_segments_are_excluded_and_original_times_are_kept():
    result = resolve_scope(speech(), 200, proposal())
    assert result["status"] == "applied" and (result["startSec"], result["endSec"]) == (20, 180)
    assert result["excludedSegmentIds"] == ["s1", "s2", "s6"]
    invalid = proposal()
    invalid.leading.quote = "지금부터 면접을 시작합니다."  # Invented quotation.
    invalid.trailing.confidence = .7
    kept = resolve_scope(speech(), 200, invalid)
    assert kept["status"] == "review_required" and not kept["excludedSegmentIds"]


def test_intro_answers_and_followups_are_retained_even_if_a_model_proposes_trimming_them():
    rows = speech()
    rows[0].text = "자기소개를 하겠습니다. 저는 검색 프로젝트를 담당했습니다."
    rows[-1].text = "추가 질문에 답변하겠습니다."
    result = resolve_scope(rows, 200, proposal(), "interview")
    assert result["status"] == "review_required" and result["startSec"] == 0 and result["endSec"] == 200
    rows = speech()
    rows[0].text = "안건 배경과 결정 기한부터 설명하겠습니다."
    assert "s1" not in resolve_scope(rows, 200, proposal())["excludedSegmentIds"]


def test_limits_and_overlapping_speech_prevent_aggressive_or_partial_cuts():
    rows = speech()
    rows[1].end = 22  # Overlaps the retained start; keep this whole turn too.
    result = resolve_scope(rows, 200, proposal())
    assert result["startSec"] == 10 and result["excludedSegmentIds"] == ["s1", "s6"]
    rows = speech(); rows[2].start = 90
    result = resolve_scope(rows, 200, proposal())
    assert result["startSec"] == 0  # Too far into the recording.
    rows = speech(); rows[0].end = 0
    assert resolve_scope(rows, 200, ScopeProposal())["excludedSegmentIds"] == []


def test_classifier_failure_retains_everything_and_passes_recording_kind_as_data():
    class Client:
        def converse(self, **kwargs):
            data = json.loads(kwargs["messages"][0]["content"][0]["text"])
            assert data["kind"] == "interview" and data["title"] == "Cloud interview"
            raise RuntimeError("provider unavailable")
    request = SttRequest(meetingId="m", audio_s3_uri="s3://bucket/audio", kind="interview", title="Cloud interview")
    result = choose_scope(speech(), 200, request, Client())
    assert result["status"] == "unavailable" and not result["excludedSegmentIds"]


def test_dictionary_corrects_aliases_without_rewriting_negation_or_factual_errors():
    source = Segment(id="s1", start=12.4, end=18.2, speaker="S2",
        text="이씨투는 객체 저장소라고 생각합니다. 다이나모 디비는 써본 적이 없습니다.",
        words=[Word(w="이씨투는", s=12.4, e=13)])
    snapshot = copy.deepcopy(source)
    corrected, report = correct_terms([source], "interview")
    assert corrected[0].text == "Amazon EC2는 객체 저장소라고 생각합니다. Amazon DynamoDB는 써본 적이 없습니다."
    assert corrected[0].originalText == source.text and corrected[0].words == []
    assert (corrected[0].id, corrected[0].start, corrected[0].end, corrected[0].speaker) == ("s1", 12.4, 18.2, "S2")
    assert report["applied"] == 2 and source == snapshot


def test_ambiguous_terms_are_review_only_and_urls_code_and_other_profiles_are_untouched():
    source = Segment(id="s", start=0, end=10, speaker="S1",
        text="AWS 람다를 씁니다. AWS 환경에서 람다 값은 0.5입니다. 벡터 검색에는 렉이 걸립니다. `다이나모 디비` https://example.org/세이지메이커")
    result, report = correct_terms([source], "lecture")
    assert "AWS Lambda를" in result[0].text and "람다 값은 0.5" in result[0].text and "렉이 걸립니다" in result[0].text
    assert "`다이나모 디비`" in result[0].text and "https://example.org/세이지메이커" in result[0].text
    assert report["review"] == 2
    lp = Segment(id="s", start=0, end=1, speaker="S1", text="오너십을 설명합니다.")
    assert correct_terms([lp], "lecture")[0][0].text == lp.text
    assert correct_terms([lp], "interview")[0][0].text == "Ownership을 설명합니다."


def test_catalog_has_stable_unique_ids_and_nonempty_spellings():
    ids = []
    for path in (Path(__file__).parents[1] / "src/stt/glossaries").glob("*.json"):
        data = json.loads(path.read_text())
        assert data["version"]
        for entry in data["entries"]:
            ids.append(entry["id"])
            assert entry["term"] and (entry["aliases"] or entry.get("contextAliases") or entry.get("reviewAliases"))
    assert len(ids) == len(set(ids)) >= 150
    dictionary("meeting"); dictionary("lecture"); dictionary("interview")


def test_queued_legacy_requests_keep_old_behavior_while_new_requests_enable_processing():
    old = SttRequest(meetingId="m", audio_s3_uri="s3://bucket/lecture-results/m/video/audio.mp3")
    assert old.kind == "lecture" and not any(old.processing.model_dump().values())
    new = SttRequest(meetingId="m", audio_s3_uri="s3://bucket/lecture-uploads/u/m/audio.mp3", kind="lecture")
    assert all(new.processing.model_dump().values())


def test_processed_artifacts_live_under_the_recording_and_original_transcript_is_not_mutated(tmp_path, monkeypatch):
    rows = speech()
    raw = SttResponse(meetingId="m", language="ko", durationSec=200, mode="intended", model="fake",
        segments=rows, speakers=[Speaker(id="S1", talkTimeSec=40), Speaker(id="S2", talkTimeSec=160)])
    snapshot = raw.model_copy(deep=True)
    class S3:
        def __init__(self): self.uploads = []
        def head_object(self, **kwargs): raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        def upload_file(self, source, bucket, key, ExtraArgs): self.uploads.append((bucket, key))
        def generate_presigned_url(self, *args, **kwargs): return "https://example.org/video"
    s3 = S3()
    monkeypatch.setattr("stt.processing.choose_scope", lambda *args: resolve_scope(rows, 200, proposal()))
    rates = []
    def export(source, target, start, end, *, bitrate_kbps):
        rates.append(bitrate_kbps)
        target.write_bytes(b"mp3")
    monkeypatch.setattr("stt.processing.export_mp3", export)
    monkeypatch.setattr("stt.processing.export_video", lambda *args: 19.0)
    request = SttRequest(meetingId="m", audio_s3_uri="s3://bucket/lecture-results/m/video/audio.mp3",
        video_s3_uri="s3://bucket/lecture-uploads/u/m/video.mp4", kind="lecture")
    result = process_transcript(raw, request, tmp_path / "input.wav", tmp_path, s3,
        {"status": "applied", "method": "fft", "reductionDb": 6}, bitrate_kbps=32, transcription_input="original")
    assert raw == snapshot
    assert [s.id for s in result.segments] == ["s3", "s4", "s5"]
    assert result.originalSegments == rows
    assert all(key.startswith("lecture-results/m/processed/") for _, key in s3.uploads)
    assert result.processing["media"]["audio"]["startSec"] == 20
    assert result.processing["media"]["video"]["startSec"] == 19
    assert result.processing["warnings"]
    assert rates == [32]
    assert result.processing["transcriptionInput"] == "original"


def test_deleted_recording_cannot_regrow_processed_files_after_a_late_upload(tmp_path, monkeypatch):
    from stt.processing import RecordingDeleted
    class S3:
        deleted = False
        removed = []
        def head_object(self, **kwargs):
            if not self.deleted: raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
            return {}
        def upload_file(self, path, bucket, key, ExtraArgs): self.deleted = True
        def delete_object(self, **kwargs): self.removed.append(kwargs["Key"])
    s3 = S3()
    rows = speech()
    raw = SttResponse(meetingId="m", language="ko", durationSec=200, mode="intended", model="fake", segments=rows, speakers=[])
    request = SttRequest(meetingId="m", audio_s3_uri="s3://bucket/uploads/u/m/audio.mp3", processing={"denoise": True, "trim": False, "terminology": False})
    monkeypatch.setattr("stt.processing.export_mp3", lambda source, target, start, end, **kwargs: target.write_bytes(b"mp3"))
    with pytest.raises(RecordingDeleted):
        process_transcript(raw, request, tmp_path / "input.wav", tmp_path, s3, {"status": "applied", "method": "fft", "reductionDb": 6})
    assert len(s3.removed) == 1 and s3.removed[0].startswith("results/m/processed/")
