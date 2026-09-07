"""AgentCore Memory for chat: conversational events per chat session (feeds the summarization strategy) plus reads of
the pipeline memory's user facts. The pipeline memory id is MEMORY_ID (shared helper); the chat memory is CHAT_MEMORY_ID."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import boto3

from .. import memory as pipeline_memory
from .config import CHAT_MEMORY_ID, REGION

log = logging.getLogger("chat.memory")
_client = None


def client():
    global _client
    if _client is None:
        _client = boto3.client("bedrock-agentcore", region_name=REGION)
    return _client


def record_turn(sub: str, session_id: str, user_text: str, assistant_text: str) -> None:
    if not CHAT_MEMORY_ID:
        return
    try:
        client().create_event(
            memoryId=CHAT_MEMORY_ID,
            actorId=sub,
            sessionId=session_id,
            eventTimestamp=datetime.now(timezone.utc),
            payload=[
                {"conversational": {"role": "USER", "content": {"text": user_text[:9000]}}},
                {"conversational": {"role": "ASSISTANT", "content": {"text": assistant_text[:9000]}}},
            ],
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("chat memory create_event failed: %s", exc)


def session_summary(sub: str, session_id: str) -> str | None:
    """Latest summary record the SUMMARIZATION strategy produced for this chat session (async, may lag)."""
    if not CHAT_MEMORY_ID:
        return None
    try:
        res = client().retrieve_memory_records(memoryId=CHAT_MEMORY_ID, namespace=f"/chat/{sub}/{session_id}", searchCriteria={"searchQuery": "conversation summary", "topK": 1})
    except Exception as exc:  # noqa: BLE001
        log.warning("chat summary retrieve failed: %s", exc)
        return None
    for rec in res.get("memoryRecordSummaries", []):
        content = rec.get("content", {})
        text = content.get("text") if isinstance(content, dict) else str(content)
        if text:
            return text
    return None


def user_facts(sub: str, query: str, top_k: int = 5) -> list[str]:
    return [r.get("text", "") for r in pipeline_memory.search_long_term(sub, query, top_k=top_k) if r.get("text")]
