"""Repair word texts that CrisperWhisper's word-timing path corrupts for multi-byte scripts.

In word-timestamp mode the library decodes word pieces token-by-token, so Hangul/CJK syllables whose bytes are
split across tokens come back as U+FFFD. A second pass without word timestamps yields clean text (decoded from
whole token sequences). We align the clean words onto the timed (corrupted) words and keep the timings.
"""
from __future__ import annotations

import difflib
import re

from .schemas import Word

REPLACEMENT = "�"
_PUNCT = re.compile(r"[\s\.\,\?\!\:\;\"'\(\)\[\]…·~]+")


def has_corruption(words: list[Word]) -> bool:
    return any(REPLACEMENT in w.w for w in words)


def _norm(s: str) -> str:
    return _PUNCT.sub("", s).lower()


def _compatible(corrupted: str, clean: str) -> bool:
    """A corrupted word is compatible with a clean word when its intact characters appear in order."""
    intact = _norm(corrupted.replace(REPLACEMENT, ""))
    tgt = _norm(clean)
    i = 0
    for ch in intact:
        j = tgt.find(ch, i)
        if j < 0:
            return False
        i = j + 1
    return True


def align_clean_words(timed: list[Word], clean_text: str) -> list[Word]:
    """Return words with texts from ``clean_text`` and timings from ``timed`` (same order)."""
    clean = clean_text.split()
    if not timed or not clean:
        return timed
    a = [_norm(w.w) for w in timed]
    b = [_norm(w) for w in clean]
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    out: list[Word] = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            out.extend(Word(w=clean[j], s=timed[i].s, e=timed[i].e, p=timed[i].p) for i, j in zip(range(i1, i2), range(j1, j2)))
        elif tag == "replace":
            out.extend(_spread(timed[i1:i2], clean[j1:j2]))
        elif tag == "delete":
            # timed words with no clean counterpart: keep them only if they are not corrupted noise
            out.extend(w for w in timed[i1:i2] if REPLACEMENT not in w.w)
        elif tag == "insert":
            # clean words missing from the timed list: interpolate between neighbours
            prev_end = out[-1].e if out else (timed[i1 - 1].e if i1 > 0 else timed[0].s)
            next_start = timed[i1].s if i1 < len(timed) else prev_end
            out.extend(_spread_interval(clean[j1:j2], prev_end, max(next_start, prev_end)))
    return out


def _spread(timed: list[Word], clean: list[str]) -> list[Word]:
    """Map n timed words onto m clean words, distributing the time span by character weight."""
    if len(timed) == len(clean):
        return [Word(w=c, s=t.s, e=t.e, p=t.p) for t, c in zip(timed, clean)]
    start, end = timed[0].s, timed[-1].e
    return _spread_interval(clean, start, end)


def _spread_interval(clean: list[str], start: float, end: float) -> list[Word]:
    total = sum(max(1, len(c)) for c in clean) or 1
    span = max(0.0, end - start)
    out, t = [], start
    for c in clean:
        d = span * max(1, len(c)) / total
        out.append(Word(w=c, s=round(t, 3), e=round(t + d, 3)))
        t += d
    return out
