"""CrisperWhisper 2.0 wrapper. Heavy imports are lazy so unit tests can import the package without GPU deps."""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

from .repair import align_clean_words, has_corruption
from .schemas import Word

log = logging.getLogger("stt.transcriber")


@dataclass
class TranscriptionResult:
    words: list[Word]
    language: str | None
    language_probability: float | None
    text: str


class Transcriber:
    def __init__(self, model_path: str | Path, backend: str = "auto", compute_type: str | None = None, device: str = "auto"):
        from crisperwhisper import CrisperWhisperModel  # lazy

        self.model_path = str(model_path)
        compute_type = compute_type or os.environ.get("STT_COMPUTE_TYPE", "float16")
        try:
            self.model = CrisperWhisperModel(self.model_path, backend=backend, compute_type=compute_type, device=device)
        except ValueError as exc:
            # float16 is GPU-only in CTranslate2; fall back so CPU-only hosts (local tests) can still load the model.
            if "float16" not in str(exc) or compute_type == "float32":
                raise
            self.model = CrisperWhisperModel(self.model_path, backend=backend, compute_type="float32", device=device)
            compute_type = "float32"
        self.compute_type = compute_type
        self.name = os.environ.get("STT_MODEL_NAME", Path(self.model_path).name)
        self._configure()

    @classmethod
    def for_testing(cls, model) -> "Transcriber":
        self = cls.__new__(cls)
        self.model, self.model_path, self.compute_type, self.name = model, "fake", "float32", "fake"
        self._configure()
        return self

    def _configure(self) -> None:
        # Whisper's decoder has 448 positions; prompt + 2*max_new_tokens must stay below that even when a
        # repetition loop runs to the limit (observed: "No position encodings are defined for positions >= 448").
        self.max_new_tokens = int(os.environ.get("STT_MAX_NEW_TOKENS", "160"))
        self.default_language = os.environ.get("STT_DEFAULT_LANGUAGE") or None
        # Language id on a short or noisy opening can return a rare language at low confidence (observed: "fo" at
        # p=0.41 on a one-minute phone recording, after which the model produced no words). Accept a detection only
        # when it is confident and one of the languages the product transcribes; otherwise use the default.
        self.language_min_prob = float(os.environ.get("STT_LANGUAGE_MIN_PROB", "0.5"))
        self.languages = {x.strip() for x in os.environ.get("STT_LANGUAGES", "ko,en,ja,zh").split(",") if x.strip()}
        log.info("transcriber configured: model=%s compute=%s max_new_tokens=%d default_language=%s languages=%s min_prob=%.2f", self.name, self.compute_type, self.max_new_tokens, self.default_language, sorted(self.languages), self.language_min_prob)

    # ---- language detection -------------------------------------------------------------------
    def detect_language(self, wav: Path) -> tuple[str | None, float | None]:
        """CTranslate2 Whisper language id on the first speech-bearing 30 s window; (None, None) if unavailable."""
        try:
            engine = getattr(self.model, "_engine", None)
            ct2_model = getattr(engine, "model", None)
            if engine is None or ct2_model is None or not hasattr(ct2_model, "detect_language"):
                return None, None
            import soundfile as sf

            audio, sr = sf.read(str(wav), dtype="float32")
            if getattr(audio, "ndim", 1) > 1:
                audio = audio.mean(axis=1)
            start = first_speech_index(audio, sr)
            clip = audio[start : start + 30 * sr]
            # Requires a CT2-format config.json with lang_ids in the model dir (scripts/stt/write_ct2_config.py).
            results = ct2_model.detect_language(engine.extract_features(clip))
            if not results or not results[0]:
                log.warning("language detection returned nothing (missing lang_ids in config.json?)")
                return None, None
            token, prob = results[0][0]
            return str(token).strip("<|>"), float(prob)
        except Exception as exc:  # noqa: BLE001
            log.warning("language detection failed: %s", exc)
            return None, None

    # ---- transcription ------------------------------------------------------------------------
    def transcribe(self, wav: Path, *, language: str | None, mode: str, hotwords: list[str]) -> TranscriptionResult:
        detected_prob: float | None = None
        if not language:
            language, detected_prob = self.detect_language(wav)
            if language and ((detected_prob or 0.0) < self.language_min_prob or language not in self.languages):
                log.info("ignoring detected language %s (p=%.2f): below %.2f or not in %s", language, detected_prob or 0.0, self.language_min_prob, sorted(self.languages))
                language, detected_prob = None, None
            if language:
                log.info("detected language %s (p=%.2f)", language, detected_prob or 0.0)
            else:
                language = self.default_language  # None keeps Whisper's implicit detection
        kwargs: dict = {"language": language, "mode": mode, "word_timestamps": True, "max_new_tokens": self.max_new_tokens}
        if hotwords:
            kwargs["hotwords"] = hotwords  # Pro models only
        result = self._run(wav, kwargs)
        words = [
            Word(w=str(getattr(w, "word", getattr(w, "w", ""))), s=float(w.start), e=float(w.end), p=_prob(w))
            for w in (getattr(result, "words", None) or [])  # None when the model produced nothing: an empty transcript, not a crash
        ]
        if has_corruption(words) and os.environ.get("STT_REPAIR_PASS", "1") == "1":
            # word-timing decode splits multi-byte characters, but result.text is decoded from whole sequences
            # and is normally clean; only re-run without timestamps when the text itself is corrupted.
            before = sum(1 for w in words if "\ufffd" in w.w)
            clean_text = getattr(result, "text", "") or ""
            source = "same pass"
            if "\ufffd" in clean_text or not clean_text.strip():
                # NOTE: timestamp_aware_drop=False produces garbage on this model; keep the default flags.
                clean_text = getattr(self._run(wav, {**kwargs, "word_timestamps": False}), "text", "") or ""
                source = "second pass"
            if "\ufffd" in clean_text:
                log.warning("clean text still contains replacement characters; leaving timed words as-is")
                clean_text = ""
            if clean_text:
                words = align_clean_words(words, clean_text)
                log.info("repaired %d corrupted words from %s text (%d words after)", before, source, len(words))
        return TranscriptionResult(
            words=words,
            language=getattr(result, "language", None) or language,
            language_probability=getattr(result, "language_probability", None) or detected_prob,
            text=getattr(result, "text", None) or "",
        )

    def _run(self, wav: Path, kwargs: dict):
        try:
            return self.model.transcribe(str(wav), **kwargs)
        except TypeError:
            if "hotwords" not in kwargs:
                raise
            kwargs = {k: v for k, v in kwargs.items() if k != "hotwords"}  # standard (non-Pro) weights
            return self._run(wav, kwargs)
        except RuntimeError as exc:
            if "position encodings" not in str(exc) or kwargs.get("max_new_tokens", 0) <= 96:
                raise
            log.warning("decoder overflow (%s); retrying with max_new_tokens=96", exc)
            return self.model.transcribe(str(wav), **{**kwargs, "max_new_tokens": 96})


def first_speech_index(audio, sr: int, frame_sec: float = 0.5, threshold_ratio: float = 0.15) -> int:
    """Start index of the first frame whose RMS exceeds a fraction of the loudest frame (skips leading silence)."""
    import numpy as np

    n = len(audio)
    frame = max(1, int(frame_sec * sr))
    if n <= frame:
        return 0
    frames = audio[: (n // frame) * frame].reshape(-1, frame)
    rms = np.sqrt((frames.astype("float32") ** 2).mean(axis=1))
    peak = float(rms.max()) if len(rms) else 0.0
    if peak <= 0:
        return 0
    idx = int(np.argmax(rms > peak * threshold_ratio))
    return max(0, min(idx * frame, n - min(n, 30 * sr)))


def _prob(w) -> float | None:
    p = getattr(w, "probability", None)
    if p is None:
        p = getattr(w, "score", None)
    return float(p) if p is not None else None
