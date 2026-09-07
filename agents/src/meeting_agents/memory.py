"""AgentCore Memory data-plane helpers (short-term stage notes + long-term retrieval)."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

import boto3

from .config import MEMORY_ID, REGION

log = logging.getLogger("agents.memory")
_client = None


def client():
    global _client
    if _client is None:
        _client = boto3.client("bedrock-agentcore", region_name=REGION)
    return _client


def record_stage_note(actor_id: str, session_id: str, stage: str, note: str) -> None:
    """Short-term memory: one OTHER-role event per stage (kept out of long-term fact extraction)."""
    if not MEMORY_ID:
        return
    try:
        client().create_event(
            memoryId=MEMORY_ID,
            actorId=actor_id,
            sessionId=session_id,
            eventTimestamp=datetime.now(timezone.utc),
            payload=[{"conversational": {"role": "OTHER", "content": {"text": f"[stage:{stage}] {note[:9000]}"}}}],
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("create_event failed: %s", exc)


def session_notes(actor_id: str, session_id: str, limit: int = 50) -> list[str]:
    if not MEMORY_ID:
        return []
    try:
        res = client().list_events(memoryId=MEMORY_ID, actorId=actor_id, sessionId=session_id, maxResults=limit, includePayloads=True)
    except Exception as exc:  # noqa: BLE001
        log.warning("list_events failed: %s", exc)
        return []
    notes = []
    for ev in res.get("events", []):
        for p in ev.get("payload", []):
            text = p.get("conversational", {}).get("content", {}).get("text")
            if text:
                notes.append(text)
    return notes


def search_long_term(actor_id: str, query: str, namespace_suffix: str = "facts", top_k: int = 8) -> list[dict]:
    if not MEMORY_ID:
        return []
    ns = f"/users/{actor_id}/{namespace_suffix}"
    try:
        res = client().retrieve_memory_records(memoryId=MEMORY_ID, namespace=ns, searchCriteria={"searchQuery": query[:1000], "topK": top_k})
    except Exception as exc:  # noqa: BLE001
        log.warning("retrieve_memory_records failed: %s", exc)
        return []
    out = []
    for rec in res.get("memoryRecordSummaries", []):
        content = rec.get("content", {})
        text = content.get("text") if isinstance(content, dict) else str(content)
        out.append({"text": text, "score": rec.get("score"), "createdAt": str(rec.get("createdAt", ""))})
    return out


def dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)
