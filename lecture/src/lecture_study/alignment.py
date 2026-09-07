"""Transcript batching and strict evidence validation. No proportional timing guesses."""
import json
from .schemas import Alignment


def transcript_batches(segments: list[dict], budget: int = 18000) -> list[list[dict]]:
    if not segments or len(segments) > 30000 or len({s["id"] for s in segments}) != len(segments):
        raise ValueError("Transcript is empty, too large, or contains duplicate segment IDs")
    batches, current, size = [], [], 0
    for segment in segments:
        if segment["start"] < 0 or segment["end"] < segment["start"]:
            raise ValueError("Invalid transcript timestamps")
        length = len(json.dumps(segment, ensure_ascii=False))
        if length > budget:
            raise ValueError("A transcript segment exceeds the analysis limit")
        if current and size + length > budget:
            batches.append(current)
            current, size = [], 0
        current.append(segment)
        size += length
    if current:
        batches.append(current)
    return batches


def validate_alignment(value: Alignment, segments: list[dict], page_count: int) -> None:
    indices = {s["id"]: i for i, s in enumerate(segments)}
    used: set[int] = set()
    for match in value.assignments:
        if match.page > page_count or match.startSegmentId not in indices or match.endSegmentId not in indices:
            raise ValueError("Alignment references an unknown page or segment ID")
        start, end = indices[match.startSegmentId], indices[match.endSegmentId]
        if end < start:
            raise ValueError("Alignment segment range is reversed")
        covered = set(range(start, end + 1))
        if used & covered:
            raise ValueError("A transcript segment was assigned to more than one slide")
        used |= covered


def page_evidence(page: int, alignments: list[Alignment], batches: list[list[dict]]) -> tuple[list[dict], dict]:
    evidence, matches = [], []
    for value, segments in zip(alignments, batches, strict=True):
        indices = {s["id"]: i for i, s in enumerate(segments)}
        for match in value.assignments:
            if match.page != page:
                continue
            matches.append(match)
            for segment in segments[indices[match.startSegmentId]:indices[match.endSegmentId] + 1]:
                evidence.append({"segmentId": segment["id"], "start": segment["start"], "end": segment["end"], "text": segment["text"], "speaker": segment.get("speaker", "S1")})
    evidence.sort(key=lambda s: s["start"])
    # Conservative: one uncertain window keeps the page marked uncertain, even if other windows are clear.
    confidence = min((m.confidence for m in matches), default=0)
    return evidence, {"status": "matched" if confidence >= 0.75 else "uncertain" if matches else "unmatched", "confidence": confidence, "reason": " / ".join(dict.fromkeys(m.reason for m in matches))[:1800]}
