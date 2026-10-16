"""End-to-end request processing: download -> normalize -> transcribe -> diarize -> align -> response."""
from __future__ import annotations

import logging
import math
import os
import tempfile
import time
from pathlib import Path
from typing import Protocol

import boto3

from .align import Turn, assign_speakers, build_segments, relabel_speakers, speaker_stats
from .audio import mp3_export_bitrate, probe_duration, to_wav16k
from .noise_reduction import reduce_noise
from .processing import process_transcript
from .schemas import SttRequest, SttResponse, Word

log = logging.getLogger("stt")
MAX_DURATION_SEC = float(os.environ.get("MAX_AUDIO_DURATION_SEC", str(4 * 3600)))


class TranscriberLike(Protocol):
    name: str

    def transcribe(self, wav: Path, *, language: str | None, mode: str, hotwords: list[str]): ...


class DiarizerLike(Protocol):
    def diarize(self, wav: Path, *, min_speakers: int | None = None, max_speakers: int | None = None) -> list[Turn]: ...


class Engine:
    def __init__(self, transcriber: TranscriberLike | None = None, diarizer: DiarizerLike | None = None, *, registry=None):
        self.transcriber = transcriber
        self.diarizer = diarizer
        self.registry = registry
        self.s3 = boto3.client("s3")

    def process(self, req: SttRequest) -> SttResponse:
        t0 = time.time()
        if self.registry is None and (req.speechModels.stt != "crisperwhisper" or req.speechModels.diarization == "nemotron3"):
            raise ValueError("선택한 음성 모델이 이 엔드포인트에 준비되지 않았습니다.")
        transcriber, diarizer = self.registry.activate(req.speechModels) if self.registry else (self.transcriber, self.diarizer)
        if transcriber is None:
            raise RuntimeError("Transcription model is not available")
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "audio.mp3"
            self._download(req.audio_s3_uri, src)
            duration = probe_duration(src)
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError("audio duration is invalid")
            if duration > MAX_DURATION_SEC:
                raise ValueError(f"audio too long: {duration:.0f}s > {MAX_DURATION_SEC:.0f}s")
            wav = to_wav16k(src, Path(tmp) / "audio.wav")
            media_wav = wav
            noise = {"status": "disabled", "method": "fft", "reductionDb": 0}
            if req.processing.denoise:
                try:
                    media_wav, noise = reduce_noise(wav, Path(tmp) / "denoised.wav")
                except Exception as error:
                    log.warning("Noise reduction failed; retaining normalized input: %s", type(error).__name__)
                    noise = {"status": "failed", "method": "fft", "reductionDb": 0}
            t1 = time.time()
            tr = transcriber.transcribe(wav, language=req.language, mode=req.mode, hotwords=req.hotwords)
            t2 = time.time()
            turns: list[Turn] = []
            if diarizer is not None and req.diarization.enabled and tr.words:
                turns = diarizer.diarize(wav, min_speakers=req.diarization.min_speakers, max_speakers=req.diarization.max_speakers)
            t3 = time.time()
            raw = build_response(req, tr.words, tr.language, tr.language_probability, turns, duration, transcriber.name, {
                "prepSec": round(t1 - t0, 2),
                "sttSec": round(t2 - t1, 2),
                "diarizeSec": round(t3 - t2, 2),
                "wordCount": len(tr.words),
                "turnCount": len(turns),
                **({"speechModelRevisions": self.registry.provenance()} if self.registry else {}),
            })
            # A cleaner listening copy is not evidence of better recognition.
            # Keep ASR and speaker embeddings on the normalized original audio.
            return process_transcript(raw, req, media_wav, Path(tmp), self.s3, noise,
                                      bitrate_kbps=mp3_export_bitrate(src), transcription_input="original")

    def _download(self, uri: str, dst: Path) -> None:
        if not uri.startswith("s3://"):
            raise ValueError("audio_s3_uri must be s3://")
        bucket, key = uri[5:].split("/", 1)
        self.s3.download_file(bucket, key, str(dst))


def build_response(
    req: SttRequest,
    words: list[Word],
    language: str | None,
    language_probability: float | None,
    turns: list[Turn],
    duration: float,
    model_name: str,
    stats: dict,
) -> SttResponse:
    turns, _mapping = relabel_speakers(turns)
    speakers = assign_speakers(words, turns)
    segments = build_segments(words, speakers)
    return SttResponse(
        meetingId=req.meetingId,
        language=language,
        languageProbability=language_probability,
        durationSec=round(duration, 3),
        mode=req.mode,
        model=model_name,
        speakers=speaker_stats(segments),
        segments=segments,
        stats=stats,
        speechModels=req.speechModels,
    )
