from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from .config import STAGES


class StagePayload(BaseModel):
    stage: str
    meetingId: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    ownerSub: str = Field(min_length=1, max_length=128)
    title: str = Field(default="회의", max_length=300)
    outputLanguage: str = Field(default="ko", max_length=8)
    transcriptKey: str = Field(min_length=1, max_length=512)
    taskToken: str | None = None
    documentKey: str | None = Field(default=None, max_length=512)

    @field_validator("stage")
    @classmethod
    def _known_stage(cls, value: str) -> str:
        # Single source of truth is config.STAGES (mirrors packages/shared STAGES), so adding a stage cannot be forgotten here.
        if value not in STAGES:
            raise ValueError(f"unknown stage {value!r}; expected one of {', '.join(STAGES)}")
        return value
