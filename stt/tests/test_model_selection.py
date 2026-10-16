import json
import sys
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf
from pydantic import ValidationError

from stt.chunks import append_chunk_words, audio_chunks, original_time_words
from stt.hf_transcriber import language_code, validate_transcription_language
from stt.model_catalog import CATALOG, DEFAULT_MODELS, LEGACY_MODELS, MODELS, SpeechModels
from stt.model_registry import ModelRegistry
from stt.schemas import SttRequest, Word


def test_new_defaults_and_explicit_legacy_request_compatibility():
    assert DEFAULT_MODELS.model_dump() == {"stt": "qwen3-asr", "diarization": "nemotron3"}
    old = SttRequest(meetingId="m", audio_s3_uri="s3://bucket/audio.mp3", kind="lecture")
    assert old.speechModels == LEGACY_MODELS
    new = SttRequest(meetingId="m", audio_s3_uri="s3://bucket/audio.mp3", speechModels=DEFAULT_MODELS)
    assert new.speechModels == DEFAULT_MODELS
    off = SttRequest(meetingId="m", audio_s3_uri="s3://bucket/audio.mp3",
                     speechModels={"stt": "qwen3-asr", "diarization": "none"})
    assert not off.diarization.enabled
    with pytest.raises(ValidationError):
        SpeechModels(stt="CohereLabs/cohere-transcribe-03-2026")
    with pytest.raises(ValidationError):
        SpeechModels(stt="https://example.org/arbitrary-model")
    with pytest.raises(ValidationError, match="Verbatim"):
        SttRequest(meetingId="m", audio_s3_uri="s3://bucket/audio.mp3", mode="verbatim", speechModels=DEFAULT_MODELS)
    with pytest.raises(ValidationError, match="English"):
        SttRequest(meetingId="m", audio_s3_uri="s3://bucket/audio.mp3", language="ko",
                   speechModels={"stt": "ark-asr", "diarization": "none"})
    assert SttRequest(meetingId="m", audio_s3_uri="s3://bucket/audio.mp3", language="en",
                      speechModels={"stt": "ark-asr", "diarization": "none"}).language == "en"


def test_chunks_cover_the_original_timeline_without_gaps_or_truncating_the_tail(tmp_path):
    source = tmp_path / "audio.wav"
    sf.write(source, np.zeros(round(61.7 * 16000), dtype=np.float32), 16000)
    chunks = list(audio_chunks(source, overlap=2))
    assert len(chunks) == 3
    assert chunks[0].offset == 0 and chunks[0].keep_start == 0
    assert chunks[-1].keep_end == pytest.approx(61.7)
    assert all(chunk.duration <= 30 for chunk in chunks)
    assert all(a.keep_end == b.keep_start for a, b in zip(chunks, chunks[1:]))
    words = original_time_words(chunks[1], [
        {"text": "left context", "start_time": .1, "end_time": .5},
        {"text": "kept", "start_time": 1, "end_time": 1.4},
    ])
    assert len(words) == 1 and words[0].w == "kept" and words[0].s == 29
    with pytest.raises(ValueError, match="outside"):
        original_time_words(chunks[1], [{"text": "invented time", "start_time": 2, "end_time": 100}])


def test_overlap_deduplication_keeps_real_repeated_words():
    words = [Word(w="yes", s=1, e=1.4)]
    append_chunk_words(words, [Word(w="yes", s=1.05, e=1.45), Word(w="yes", s=1.5, e=1.9)])
    assert [(word.s, word.e) for word in words] == [(1, 1.4), (1.5, 1.9)]


def test_language_alignment_never_claims_unsupported_timestamps():
    assert language_code("Korean") == "ko"
    assert language_code(None, "안녕하세요 AWS") == "ko"
    assert language_code(None, "こんにちは") == "ja"
    assert language_code(None, "你好") == "zh"
    with pytest.raises(ValueError, match="정렬"):
        language_code("Hungarian")
    with pytest.raises(ValueError, match="다른 언어"):
        validate_transcription_language("こんにちは。これはアマゾンのサービスです。", "ko")
    validate_transcription_language("한국어 설명에 Amazon S3와 일본어 こんにちは 예시가 함께 있습니다.", "ko")


def bundle(root):
    (root / "bundle-manifest.json").write_text(json.dumps({**CATALOG, "legacyArtifactRevision": "legacy-v1"}))
    for spec in MODELS.values():
        directory = root / spec["directory"]
        directory.mkdir()
        (directory / "config.json").write_text("{}")
        (directory / "model.safetensors").write_bytes(b"fixture")
    for relative in ("crisperwhisper/ct2/model.bin", "pyannote/community-1/config.yaml"):
        file = root / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(b"fixture")


def test_registry_switches_selection_without_silent_fallback_and_can_disable_diarization(tmp_path, monkeypatch):
    bundle(tmp_path)
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)))
    monkeypatch.setattr("stt.hf_transcriber.ForcedAligner", lambda *args: "aligner")
    loaded = []
    def transcriber(key, path, aligner, device):
        loaded.append(key)
        return SimpleNamespace(name=key, aligner=aligner)
    monkeypatch.setattr("stt.hf_transcriber.HfTranscriber", transcriber)
    monkeypatch.setattr("stt.nemotron.NemotronDiarizer", lambda *args: "nemotron")
    registry = ModelRegistry(tmp_path, device="cpu")
    first, diarizer = registry.activate(DEFAULT_MODELS)
    assert first.name == "qwen3-asr" and diarizer == "nemotron"
    assert registry.activate(DEFAULT_MODELS)[0] is first and loaded == ["qwen3-asr"]
    other, diarizer = registry.activate(SpeechModels(stt="ark-asr", diarization="none"))
    assert other.name == "ark-asr" and other is not first and diarizer is None
    assert set(registry.provenance()) == {"ark-asr", "qwen3-aligner"}
    assert loaded == ["qwen3-asr", "ark-asr"]


def test_incomplete_or_wrong_bundle_is_rejected_before_serving(tmp_path):
    bundle(tmp_path)
    (tmp_path / MODELS["ark-asr"]["directory"] / "model.safetensors").unlink()
    with pytest.raises(ValueError, match="incomplete"):
        ModelRegistry(tmp_path)
    (tmp_path / "bundle-manifest.json").write_text(json.dumps({"version": "wrong", "models": MODELS}))
    with pytest.raises(ValueError, match="catalog"):
        ModelRegistry(tmp_path)
