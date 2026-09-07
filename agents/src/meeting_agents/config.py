from __future__ import annotations

import os
from pathlib import Path

REGION = os.environ.get("AWS_REGION", "us-east-1")
DATA_BUCKET = os.environ.get("DATA_BUCKET", "")
TABLE_NAME = os.environ.get("TABLE_NAME", "")
MEMORY_ID = os.environ.get("MEMORY_ID", "")
OPUS = os.environ.get("ANTHROPIC_DEFAULT_OPUS_MODEL", "global.anthropic.claude-opus-5")
SONNET = os.environ.get("ANTHROPIC_DEFAULT_SONNET_MODEL", "global.anthropic.claude-sonnet-5")
WORK_ROOT = Path(os.environ.get("WORK_ROOT", str(Path.home() / "work")))
PROMPTS_DIR = Path(os.environ.get("PROMPTS_DIR", str(Path(__file__).resolve().parents[2] / "prompts")))
HEARTBEAT_SEC = int(os.environ.get("HEARTBEAT_SEC", "240"))
STAGE_BUDGET_USD = float(os.environ.get("STAGE_BUDGET_USD", "50"))
CHUNK_MINUTES = int(os.environ.get("CHUNK_MINUTES", "15"))

STAGES = [
    "transcript_analysis",
    "topic_segmentation",
    "speaker_attribution",
    "agenda",
    "summary",
    "notes",
    "follow_ups",
    "suggestions",
    "mindmap",
    "meeting_brief",
]
