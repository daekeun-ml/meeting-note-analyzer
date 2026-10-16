from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator
from .model_catalog import LEGACY_MODELS, SpeechModels


class DiarizationOptions(BaseModel):
    enabled: bool = True
    min_speakers: int | None = None
    max_speakers: int | None = None


class ProcessingOptions(BaseModel):
    denoise: bool = True
    trim: bool = True
    terminology: bool = True


class SttRequest(BaseModel):
    meetingId: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    audio_s3_uri: str
    video_s3_uri: str | None = None
    kind: Literal["meeting", "lecture", "interview"] = "meeting"
    title: str = Field(default="", max_length=300)
    context: str = Field(default="", max_length=1000)
    scope_model: Literal["opus", "sonnet"] = "opus"
    processing: ProcessingOptions = Field(default_factory=ProcessingOptions)
    speechModels: SpeechModels = Field(default_factory=SpeechModels)
    language: str | None = None
    mode: Literal["intended", "verbatim"] = "intended"
    hotwords: list[str] = Field(default_factory=list)
    diarization: DiarizationOptions = Field(default_factory=DiarizationOptions)

    @model_validator(mode="before")
    @classmethod
    def legacy_request(cls, value):
        if isinstance(value, dict):
            value = dict(value)
            # Requests queued before model selection was introduced keep their
            # existing engines; the updated API sends an explicit selection.
            value.setdefault("speechModels", LEGACY_MODELS.model_dump())
            diarization = value.get("diarization", {})
            disabled = (diarization.get("enabled") is False) if isinstance(diarization, dict) else getattr(diarization, "enabled", True) is False
            selection = value["speechModels"]
            if isinstance(selection, SpeechModels):
                selection = selection.model_dump()
            if disabled and isinstance(selection, dict):
                value["speechModels"] = {**selection, "diarization": "none"}
        if isinstance(value, dict) and "kind" not in value:
            value = dict(value)
            path = str(value.get("audio_s3_uri", "")).split("/", 3)[-1]
            value["kind"] = "interview" if path.startswith("interview-uploads/") else "lecture" if path.startswith(("lecture-uploads/", "lecture-results/")) else "meeting"
            # Requests already queued during rollout must retain their old behavior.
            value.setdefault("processing", {"denoise": False, "trim": False, "terminology": False})
        return value

    @model_validator(mode="after")
    def compatible_modes(self):
        if self.speechModels.stt != "crisperwhisper" and self.mode == "verbatim":
            raise ValueError("Verbatim mode requires CrisperWhisper")
        if self.speechModels.stt == "ark-asr" and self.language != "en":
            raise ValueError("ARK is currently enabled for explicitly English audio only")
        if self.speechModels.diarization == "none":
            self.diarization = self.diarization.model_copy(update={"enabled": False})
        return self


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
    originalText: str | None = None
    termCorrections: list[dict] = Field(default_factory=list)
    termSuggestions: list[dict] = Field(default_factory=list)


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
    originalSegments: list[Segment] | None = None
    processing: dict | None = None
    speechModels: SpeechModels | None = None
