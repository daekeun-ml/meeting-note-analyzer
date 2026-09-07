from __future__ import annotations

import os

REGION = os.environ.get("AWS_REGION", "us-east-1")
TABLE_NAME = os.environ.get("TABLE_NAME", "")
LECTURE_TABLE_NAME = os.environ.get("LECTURE_TABLE_NAME", "")
DATA_BUCKET = os.environ.get("DATA_BUCKET", "")
CHAT_MEMORY_ID = os.environ.get("CHAT_MEMORY_ID", "")
GATEWAY_URL = os.environ.get("GATEWAY_URL", "")
GATEWAY_TOOL = os.environ.get("GATEWAY_TOOL", "managed-kb___Retrieve")
WEB_ORIGIN = os.environ.get("WEB_ORIGIN", "")
CHAT_MODEL = os.environ.get("ANTHROPIC_DEFAULT_SONNET_MODEL", "global.anthropic.claude-sonnet-5")
SUMMARY_MODEL = os.environ.get("ANTHROPIC_DEFAULT_HAIKU_MODEL", "global.anthropic.claude-haiku-4-5-20251001-v1:0")
HISTORY_TURNS = int(os.environ.get("CHAT_HISTORY_TURNS", "12"))
CONTEXT_BUDGET_CHARS = int(os.environ.get("CHAT_CONTEXT_BUDGET_CHARS", "80000"))
MAX_RESULTS = int(os.environ.get("CHAT_MAX_RESULTS", "8"))
MAX_TURNS = int(os.environ.get("CHAT_MAX_TURNS", "12"))
KEEPALIVE_SEC = float(os.environ.get("CHAT_KEEPALIVE_SEC", "10"))
