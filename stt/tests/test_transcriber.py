import numpy as np
import pytest

from stt.transcriber import Transcriber, first_speech_index


class FakeWord:
    def __init__(self, word, start, end):
        self.word, self.start, self.end = word, start, end


class FakeResult:
    def __init__(self):
        self.words = [FakeWord(" 안녕하세요", 0.0, 0.5)]
        self.text = "안녕하세요"


class OverflowOnceModel:
    def __init__(self):
        self.calls = []

    def transcribe(self, path, **kwargs):
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            raise RuntimeError("No position encodings are defined for positions >= 448, but got position 448")
        return FakeResult()


class NoHotwordsModel:
    def __init__(self):
        self.calls = []

    def transcribe(self, path, **kwargs):
        self.calls.append(kwargs)
        if "hotwords" in kwargs:
            raise TypeError("unexpected keyword argument 'hotwords'")
        return FakeResult()


def test_retries_with_smaller_token_budget_on_position_overflow(monkeypatch):
    monkeypatch.setenv("STT_MAX_NEW_TOKENS", "160")
    m = OverflowOnceModel()
    t = Transcriber.for_testing(m)
    res = t.transcribe("x.wav", language="ko", mode="intended", hotwords=[])
    assert [c["max_new_tokens"] for c in m.calls] == [160, 96]
    assert res.language == "ko" and res.words[0].w == " 안녕하세요"


def test_overflow_twice_raises():
    class AlwaysOverflow:
        def transcribe(self, path, **kwargs):
            raise RuntimeError("No position encodings are defined for positions >= 448")

    t = Transcriber.for_testing(AlwaysOverflow())
    with pytest.raises(RuntimeError):
        t.transcribe("x.wav", language="ko", mode="intended", hotwords=[])


def test_hotwords_dropped_for_standard_models():
    m = NoHotwordsModel()
    t = Transcriber.for_testing(m)
    t.transcribe("x.wav", language="en", mode="verbatim", hotwords=["PG"])
    assert "hotwords" in m.calls[0] and "hotwords" not in m.calls[1]


def test_language_detection_unavailable_keeps_auto(monkeypatch):
    monkeypatch.delenv("STT_DEFAULT_LANGUAGE", raising=False)
    m = NoHotwordsModel()  # no _engine attribute -> detection unavailable
    t = Transcriber.for_testing(m)
    res = t.transcribe("x.wav", language=None, mode="intended", hotwords=[])
    assert m.calls[0]["language"] is None and res.language is None


def test_first_speech_index_skips_leading_silence():
    sr = 16000
    audio = np.concatenate([np.zeros(sr * 3, dtype="float32"), np.random.uniform(-0.5, 0.5, sr * 40).astype("float32")])
    idx = first_speech_index(audio, sr)
    assert sr * 2.5 <= idx <= sr * 3.5
    assert first_speech_index(np.zeros(sr, dtype="float32"), sr) == 0


def test_repair_uses_same_pass_text_when_clean():
    class Model:
        def __init__(self):
            self.calls = []

        def transcribe(self, path, **kwargs):
            self.calls.append(kwargs)
            r = FakeResult()
            r.words = [FakeWord(" 부탁드���요.", 0.0, 1.0)]
            r.text = "부탁드려요."  # whole-sequence decode is clean
            return r

    m = Model()
    t = Transcriber.for_testing(m)
    res = t.transcribe("x.wav", language="ko", mode="intended", hotwords=[])
    assert [c["word_timestamps"] for c in m.calls] == [True]
    assert res.words[0].w == "부탁드려요." and res.words[0].e == 1.0


def test_repair_falls_back_to_second_pass_when_text_corrupted():
    class Model:
        def __init__(self):
            self.calls = []

        def transcribe(self, path, **kwargs):
            self.calls.append(kwargs)
            r = FakeResult()
            if kwargs.get("word_timestamps"):
                r.words = [FakeWord(" 부탁드���요.", 0.0, 1.0)]
                r.text = "부탁드���요."
            else:
                r.text = "부탁드려요."
            return r

    m = Model()
    t = Transcriber.for_testing(m)
    res = t.transcribe("x.wav", language="ko", mode="intended", hotwords=[])
    assert [c["word_timestamps"] for c in m.calls] == [True, False]
    assert "timestamp_aware_drop" not in m.calls[1]
    assert res.words[0].w == "부탁드려요."


class EmptyResultModel:
    """CrisperWhisper returns words=None (and no text) for some language/recording combinations."""
    def __init__(self):
        self.calls = []

    def transcribe(self, path, **kwargs):
        self.calls.append(kwargs)
        r = FakeResult()
        r.words, r.text = None, None
        return r


@pytest.mark.parametrize(("detected", "expected"), [
    (("fo", 0.41), "ko"),   # rare language at low confidence (seen on a 1-minute phone recording): fall back
    (("fo", 0.95), "ko"),   # confident but outside the languages the product transcribes: fall back
    (("en", 0.45), "ko"),   # supported but not confident enough
    (("en", 0.9), "en"),    # supported and confident: accepted
])
def test_language_detection_is_accepted_only_when_confident_and_supported(monkeypatch, detected, expected):
    monkeypatch.setenv("STT_DEFAULT_LANGUAGE", "ko")
    monkeypatch.delenv("STT_LANGUAGES", raising=False)
    m = NoHotwordsModel()
    t = Transcriber.for_testing(m)
    monkeypatch.setattr(t, "detect_language", lambda wav: detected)
    res = t.transcribe("x.wav", language=None, mode="intended", hotwords=[])
    assert m.calls[0]["language"] == expected and res.language == expected


def test_result_without_words_becomes_an_empty_transcript_instead_of_a_400(monkeypatch):
    monkeypatch.setenv("STT_DEFAULT_LANGUAGE", "ko")
    t = Transcriber.for_testing(EmptyResultModel())
    res = t.transcribe("x.wav", language="ko", mode="intended", hotwords=[])
    assert res.words == [] and res.text == ""
