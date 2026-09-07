"""In-process MCP tools exposed to the stage agents (memory + transcript windows)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from . import memory
from .transcript import Transcript


def build_server(*, actor_id: str, session_id: str, transcript: Transcript, workdir: Path):
    def text(payload: Any) -> dict:
        return {"content": [{"type": "text", "text": payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)}]}

    @tool("get_transcript_window", "Return transcript segments overlapping [start_sec, end_sec] (max ~10 minutes per call).", {"start_sec": float, "end_sec": float})
    async def get_transcript_window(args: dict) -> dict:
        start, end = float(args["start_sec"]), float(args["end_sec"])
        if end - start > 660:
            end = start + 660
        segs = transcript.window(start, end)
        return text("\n".join(transcript.segment_line(s) for s in segs) or "(no segments in window)")

    @tool("get_speaker_stats", "Talk time and turn counts per diarized speaker id.", {})
    async def get_speaker_stats(_args: dict) -> dict:
        return text(transcript.speaker_stats())

    @tool("list_prior_outputs", "List prior stage output files available in the working directory (read them with Read).", {})
    async def list_prior_outputs(_args: dict) -> dict:
        files = sorted(p.name for p in (workdir / "prior").glob("*.json")) if (workdir / "prior").exists() else []
        return text({"prior": files})

    @tool("memory_search", "Search this user's long-term memory of PAST meetings (people, roles, projects, decisions, open items). Query in any language.", {"query": str})
    async def memory_search(args: dict) -> dict:
        return text({"records": memory.search_long_term(actor_id, str(args["query"]))})

    @tool("session_notes", "Short-term notes written by earlier stages of THIS meeting's analysis.", {})
    async def session_notes(_args: dict) -> dict:
        return text({"notes": memory.session_notes(actor_id, session_id)})

    return create_sdk_mcp_server(name="meeting", version="1.0.0", tools=[get_transcript_window, get_speaker_stats, list_prior_outputs, memory_search, session_notes])


TOOL_NAMES = ["mcp__meeting__get_transcript_window", "mcp__meeting__get_speaker_stats", "mcp__meeting__list_prior_outputs", "mcp__meeting__memory_search", "mcp__meeting__session_notes"]
