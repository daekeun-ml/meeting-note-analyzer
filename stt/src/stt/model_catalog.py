"""Curated model identities and immutable Hugging Face revisions."""
from typing import Literal
import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict


class SpeechModels(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stt: Literal["qwen3-asr", "crisperwhisper", "ark-asr"] = "qwen3-asr"
    diarization: Literal["nemotron3", "community1", "none"] = "nemotron3"


DEFAULT_MODELS = SpeechModels()
LEGACY_MODELS = SpeechModels(stt="crisperwhisper", diarization="community1")
CATALOG = json.loads(Path(__file__).with_name("model_catalog.json").read_text())
CATALOG_VERSION = CATALOG["version"]
MODELS = CATALOG["models"]
