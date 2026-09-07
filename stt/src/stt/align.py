"""Pure alignment logic: assign speaker turns to words and rebuild speaker-homogeneous segments.

Kept dependency-free so it is unit-testable on any machine.
"""
from __future__ import annotations

from dataclasses import dataclass

from .schemas import Segment, Speaker, Word

SENTENCE_END = tuple(".?!。？！")


@dataclass(frozen=True)
class Turn:
    start: float
    end: float
    speaker: str


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def assign_speakers(words: list[Word], turns: list[Turn], default: str = "S1") -> list[str]:
    """For each word pick the turn with maximal temporal overlap; fall back to the nearest turn."""
    if not turns:
        return [default] * len(words)
    turns = sorted(turns, key=lambda t: t.start)
    out: list[str] = []
    for w in words:
        best, best_ov = None, 0.0
        for t in turns:
            if t.start > w.e + 2.0:
                break
            ov = _overlap(w.s, w.e, t.start, t.end)
            if ov > best_ov:
                best, best_ov = t.speaker, ov
        if best is None:
            mid = (w.s + w.e) / 2
            nearest = min(turns, key=lambda t: min(abs(t.start - mid), abs(t.end - mid)))
            best = nearest.speaker
        out.append(best)
    return out


def relabel_speakers(turns: list[Turn]) -> tuple[list[Turn], dict[str, str]]:
    """Map diarizer labels (SPEAKER_00, ...) to S1..Sn ordered by first appearance."""
    mapping: dict[str, str] = {}
    for t in sorted(turns, key=lambda t: t.start):
        if t.speaker not in mapping:
            mapping[t.speaker] = f"S{len(mapping) + 1}"
    return [Turn(t.start, t.end, mapping[t.speaker]) for t in turns], mapping


def build_segments(
    words: list[Word],
    speakers: list[str],
    *,
    max_gap: float = 1.2,
    max_words: int = 60,
    max_duration: float = 30.0,
) -> list[Segment]:
    """Group consecutive same-speaker words into segments, breaking on sentence ends, long gaps, or size."""
    segments: list[Segment] = []
    cur: list[Word] = []
    cur_speaker: str | None = None

    def flush() -> None:
        nonlocal cur, cur_speaker
        if not cur:
            return
        text = _join_words([w.w for w in cur])
        segments.append(
            Segment(
                id=f"seg-{len(segments) + 1:04d}",
                start=round(cur[0].s, 3),
                end=round(cur[-1].e, 3),
                speaker=cur_speaker or "S1",
                text=text,
                words=list(cur),
            )
        )
        cur, cur_speaker = [], None

    for w, spk in zip(words, speakers, strict=True):
        if cur and (
            spk != cur_speaker
            or w.s - cur[-1].e > max_gap
            or len(cur) >= max_words
            or w.e - cur[0].s > max_duration
        ):
            flush()
        if not cur:
            cur_speaker = spk
        cur.append(w)
        # sentence end: flush unless it would leave a tiny fragment (<3 words and <1s)
        if w.w.rstrip().endswith(SENTENCE_END) and (len(cur) >= 3 or cur[-1].e - cur[0].s >= 1.0):
            flush()
    flush()
    return segments


def _join_words(tokens: list[str]) -> str:
    """Whisper-style tokens usually carry their own leading space; be robust when they do not."""
    out = ""
    for tok in tokens:
        if not out:
            out = tok.strip()
        elif tok.startswith(" ") or out.endswith((" ", "(", "[")) or tok[:1] in ",.?!;:)]%":
            out += tok if tok.startswith(" ") else tok.strip()
        else:
            out += " " + tok.strip()
    return " ".join(out.split())


def speaker_stats(segments: list[Segment]) -> list[Speaker]:
    talk: dict[str, float] = {}
    for s in segments:
        talk[s.speaker] = talk.get(s.speaker, 0.0) + max(0.0, s.end - s.start)
    return [Speaker(id=k, talkTimeSec=round(v, 1)) for k, v in sorted(talk.items(), key=lambda kv: -kv[1])]
