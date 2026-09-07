"""Content sanity checks applied after schema validation: reject placeholder or near-empty stage outputs.

A model can end its turn by calling the structured-output tool with draft values ("placeholder"); the JSON is
schema-valid, so pydantic accepts it. These checks catch that and trigger a correction pass instead of storing junk.
"""
from __future__ import annotations

import re
from typing import Any

# Whole-value markers only ("placeholder" inside a real sentence can be a legitimate UX term).
_PLACEHOLDER = re.compile(r"^\s*(?:[\w-]*placeholder[\w-]*|lorem ipsum.*|todo|tbd|n/?a|dummy|sample text|to be filled|\.\.\.|-)\s*$", re.IGNORECASE)

# Minimum sizes per stage: (json path, minimum length or count, description)
_MINIMUMS: dict[str, list[tuple[str, int, str]]] = {
    "meeting_brief": [("headline", 1, "missing core outcome")],
    "summary": [("headline", 15, "headline shorter than 15 characters"), ("overview", 200, "overview shorter than 200 characters"), ("keyDiscussions", 1, "no key discussions"), ("markdown", 300, "markdown shorter than 300 characters")],
    "agenda": [("items", 1, "no agenda items")],
    "notes": [("sections", 1, "no note sections"), ("markdown", 100, "markdown shorter than 100 characters")],
    "topic_segmentation": [("topics", 1, "no topics"), ("overview", 50, "overview shorter than 50 characters")],
    "speaker_attribution": [("speakers", 1, "no speakers")],
    "suggestions": [("items", 1, "no suggestions")],
    "transcript_analysis": [("primaryLanguage", 2, "primaryLanguage missing")],
    "mindmap": [("nodes", 8, "fewer than 8 nodes")],
}


def _strings(value: Any, path: str = "") -> list[tuple[str, str]]:
    if isinstance(value, str):
        return [(path, value)]
    if isinstance(value, dict):
        return [s for k, v in value.items() for s in _strings(v, f"{path}.{k}" if path else k)]
    if isinstance(value, list):
        return [s for i, v in enumerate(value) for s in _strings(v, f"{path}[{i}]")]
    return []


def problems(stage: str, data: dict) -> list[str]:
    """Human-readable defects, empty when the output looks like real content."""
    out: list[str] = []
    hits = [(p, s) for p, s in _strings(data) if _PLACEHOLDER.search(s)]
    if hits:
        out.append("placeholder text in " + ", ".join(p for p, _ in hits[:6]) + (" ..." if len(hits) > 6 else ""))
    for path, minimum, description in _MINIMUMS.get(stage, []):
        value = data.get(path)
        size = len(value) if isinstance(value, (str, list, dict)) else 0
        if size < minimum:
            out.append(description)
    return out
