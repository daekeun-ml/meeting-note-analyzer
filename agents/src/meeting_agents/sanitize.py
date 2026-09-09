"""Deterministic guard for the writing-style rules: strip emoji and decorative punctuation from every string field.

The prompts forbid these characters, but a model can still slip one in; this keeps the stored output clean regardless.
"""
from __future__ import annotations

import re
from copy import deepcopy
from typing import Any

_REPLACEMENTS = [("·", ", "), ("ㆍ", ", "), ("•", ""), ("→", " -> "), ("—", " - "), ("―", " - "), ("–", "-")]
_SYMBOLS = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿←-⇿️‍]")
_TIDY = [(re.compile(r"(, )+,"), ","), (re.compile(r"[ \t]{2,}"), " "), (re.compile(r" +([,.;:)])"), r"\1"), (re.compile(r"\( +"), "(")]


def clean_text(text: str) -> str:
    out = text
    for src, dst in _REPLACEMENTS:
        out = out.replace(src, dst)
    out = _SYMBOLS.sub("", out)
    for pattern, repl in _TIDY:
        out = pattern.sub(repl, out)
    return out.strip() if text.strip() == text else out


def clean_output(value: Any) -> Any:
    """Recursively clean every string in a JSON-like structure (keys are left untouched)."""
    if isinstance(value, str):
        return clean_text(value)
    if isinstance(value, list):
        return [clean_output(v) for v in value]
    if isinstance(value, dict):
        return {k: clean_output(v) for k, v in value.items()}
    return value


def clean_attribution(draft: dict[str, Any]) -> dict[str, Any]:
    """Speaker attribution: clean names, roles, reasons and notes, but keep `support[].quote` verbatim so the quotes still verify against the transcript."""
    out = clean_output(draft)
    for key in ("speakers", "merges", "relabels"):
        for original, cleaned in zip(draft.get(key, []), out.get(key, []), strict=True):
            if "support" in original:
                cleaned["support"] = deepcopy(original["support"])
    return out
