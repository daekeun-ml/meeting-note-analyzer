"""Transcript loading, chunking and speaker relabeling helpers (pure Python, unit-tested)."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def hms(sec: float) -> str:
    s = max(0, int(sec))
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


@dataclass
class Transcript:
    data: dict[str, Any]

    @classmethod
    def load(cls, path: Path) -> "Transcript":
        return cls(json.loads(path.read_text(encoding="utf-8")))

    @property
    def segments(self) -> list[dict[str, Any]]:
        return self.data["segments"]

    @property
    def duration(self) -> float:
        return float(self.data.get("durationSec", 0))

    def segment_line(self, seg: dict[str, Any]) -> str:
        label = seg.get("speakerLabel", seg["speaker"])
        speaker = seg["speaker"] if label == seg["speaker"] else f"{seg['speaker']} ({label})"
        review = " [speaker review required]" if seg.get("speakerReviewRequired") else ""
        return f"[{hms(seg['start'])}] {speaker}{review} ({seg['id']}): {seg['text']}"

    def window(self, start_sec: float, end_sec: float) -> list[dict[str, Any]]:
        return [s for s in self.segments if s["end"] >= start_sec and s["start"] <= end_sec]

    def to_markdown(self, title: str) -> str:
        head = [f"# {title}", "", f"- duration: {hms(self.duration)}, language: {self.data.get('language')}, speakers: {', '.join(s['id'] for s in self.data.get('speakers', []))}", ""]
        return "\n".join(head + [self.segment_line(s) for s in self.segments]) + "\n"

    def chunks(self, minutes: int) -> list[tuple[int, float, float, list[dict[str, Any]]]]:
        """Split by wall-clock windows; returns (index, start, end, segments)."""
        size = minutes * 60
        out = []
        idx, start = 1, 0.0
        total = max(self.duration, self.segments[-1]["end"] if self.segments else 0.0)
        while start < total or idx == 1:
            end = start + size
            segs = [s for s in self.segments if s["start"] >= start and s["start"] < end]
            out.append((idx, start, min(end, total), segs))
            idx += 1
            start = end
            if start >= total:
                break
        return out

    def write_chunks(self, directory: Path, minutes: int, title: str) -> list[Path]:
        directory.mkdir(parents=True, exist_ok=True)
        paths = []
        for idx, start, end, segs in self.chunks(minutes):
            p = directory / f"chunk-{idx:02d}.md"
            body = [f"# {title}: chunk {idx} ({hms(start)}-{hms(end)})", ""] + [self.segment_line(s) for s in segs]
            p.write_text("\n".join(body) + "\n", encoding="utf-8")
            paths.append(p)
        return paths

    def speaker_stats(self) -> list[dict[str, Any]]:
        talk: dict[str, float] = {}
        turns: dict[str, int] = {}
        for s in self.segments:
            talk[s["speaker"]] = talk.get(s["speaker"], 0.0) + max(0.0, s["end"] - s["start"])
            turns[s["speaker"]] = turns.get(s["speaker"], 0) + 1
        return [{"id": k, "talkTimeSec": round(v, 1), "turns": turns[k]} for k, v in sorted(talk.items(), key=lambda kv: -kv[1])]


def apply_attribution(transcript: dict[str, Any], attribution: dict[str, Any]) -> dict[str, Any]:
    """Apply only verified proposals; preserve uncertain ones for review."""
    from .attribution import reconcile_attribution

    return reconcile_attribution(transcript, attribution)[1]
