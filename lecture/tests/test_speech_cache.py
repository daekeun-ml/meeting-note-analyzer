import copy
import threading
from types import SimpleNamespace

from lecture_study.store import Store


def cache_store(values, transcript, models=True):
    store = Store.__new__(Store)
    store.request = SimpleNamespace(phase="analyze")
    store.prefix, store._speech_cache, store._speech_cache_lock = "lecture-results/test/", None, threading.Lock()
    store.record = lambda: {"transcriptKey": "transcript", **({"speechModels": {"stt": "qwen3-asr", "diarization": "nemotron3"}} if models else {})}
    store.read = lambda key: copy.deepcopy(transcript if key == "transcript" else values.get(key))
    store.save = lambda key, value: values.__setitem__(store.prefix + key, copy.deepcopy(value))
    return store


def test_new_record_caches_follow_actual_transcript_content_and_legacy_caches_remain_compatible():
    values, calls = {}, []
    build = lambda: calls.append("build") or {"summary": f"version-{len(calls)}"}
    original = {"model": "qwen", "segments": [{"text": "first", "start": 1, "end": 2}]}
    first = cache_store(values, original)
    assert first.cached("study.json", build) == {"summary": "version-1"}
    assert cache_store(values, original).cached("study.json", build) == {"summary": "version-1"}
    changed = {**original, "segments": [{"text": "corrected", "start": 1.1, "end": 2.2}]}
    assert cache_store(values, changed).cached("study.json", build) == {"summary": "version-2"}
    assert len(calls) == 2
    values["lecture-results/test/cache/v2/study.json"] = {"summary": "legacy"}
    assert cache_store(values, original, models=False).cached("study.json", build) == {"summary": "legacy"}
