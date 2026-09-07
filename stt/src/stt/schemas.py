from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class DiarizationOptions(BaseModel):
    enabled: bool = True
    min_speakers: int | None = None
    max_speakers: int | None = None


class SttRequest(BaseModel):
    meetingId: str
    audio_s3_uri: str
    language: str | None = None
    mode: Literal["intended", "verbatim"] = "intended"
    hotwords: list[str] = Field(default_factory=list)
    diarization: DiarizationOptions = Field(default_factory=DiarizationOptions)


class Word(BaseModel):
    w: str
    s: float
    e: float
    p: float | None = None


class Segment(BaseModel):
    id: str
    start: float
    end: float
    speaker: str
    text: str
    words: list[Word] = Field(default_factory=list)


class Speaker(BaseModel):
    id: str
    talkTimeSec: float


class SttResponse(BaseModel):
    version: Literal[1] = 1
    meetingId: str
    language: str | None
    languageProbability: float | None = None
    durationSec: float
    mode: Literal["intended", "verbatim"]
    model: str
    speakers: list[Speaker]
    segments: list[Segment]
    stats: dict = Field(default_factory=dict)
