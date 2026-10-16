"""Versioned dictionary aliases; fuzzy matches are review suggestions, never corrections."""
from __future__ import annotations

import difflib
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from .schemas import Segment

VERSION = "2026-10-16.v1"
PROTECTED = re.compile(r"https?://\S+|[\w.+-]+@[\w.-]+\.\w+|`[^`]*`", re.I)
PARTICLES = r"에서는|에서부터|으로는|으로|이라서|이라고|이라는|입니다|이에요|예요|에서|에게|처럼|부터|까지|이랑|하고|은|는|이|가|을|를|에|로|와|과|도|의|만|랑"


def key(text):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", text)).casefold()


def has_context(term, text):
    folded = term.casefold()
    if re.fullmatch(r"[a-z0-9 -]+", folded):
        return bool(re.search(r"(?<![a-z0-9])" + re.escape(folded) + r"(?![a-z0-9])", text))
    return folded in text


@lru_cache(maxsize=3)
def dictionary(kind):
    entries = []
    for path in sorted(Path(__file__).with_name("glossaries").glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if data["domain"] == "interview" and kind != "interview":
            continue
        entries.extend(data["entries"])
    aliases = {}
    for entry in entries:
        for mode, values in ((0, entry["aliases"]), (1, entry.get("contextAliases", [])), (2, entry.get("reviewAliases", []))):
            for value in values:
                variants = [value]
                if entry["term"].startswith(("Amazon ", "AWS ")) and not value.startswith(("아마존", "AWS ", "Amazon ", "에이더블유에스")):
                    variants += ["아마존 " + value, "AWS " + value, "Amazon " + value]
                for alias in variants:
                    normal = key(alias)
                    aliases.setdefault(normal, []).append((entry, mode if alias == value else 0))
    pattern = "|".join(r"\s*".join(re.escape(char) for char in k)
                       for k in sorted(aliases, key=len, reverse=True))
    matcher = re.compile(r"(?<![A-Za-z0-9가-힣])(?:" + pattern + r")(?=$|[^A-Za-z0-9가-힣]|(?:" + PARTICLES + r")(?=$|[^A-Za-z0-9가-힣]))", re.I)
    fuzzy = {}
    for alias, candidates in aliases.items():
        if len(alias) >= 5 and re.fullmatch("[가-힣]+", alias) and len({e["term"] for e, _ in candidates}) == 1:
            fuzzy.setdefault((alias[0], len(alias)), []).append((alias, candidates[0][0]))
    return aliases, matcher, fuzzy


def correct_terms(segments: list[Segment], kind: str, context=""):
    aliases, matcher, fuzzy = dictionary(kind)
    output, applied, reviews = [], 0, 0
    for segment in segments:
        text = segment.text
        protected = [(m.start(), m.end()) for m in PROTECTED.finditer(text)]
        corrections, suggestions, pieces, previous = [], [], [], 0
        matched = []
        for match in matcher.finditer(text):
            if any(a < match.end() and match.start() < b for a, b in protected):
                continue
            nearby = (context + " " + text[max(0, match.start() - 150):match.end() + 150]).casefold()
            choices = aliases[key(match.group())]
            candidates = {entry["term"]: entry for entry, mode in choices
                          if mode == 0 or (mode == 1 and any(has_context(term, nearby) for term in entry.get("context", [])))}
            if len(candidates) != 1:
                review = {entry["term"]: entry for entry, mode in choices
                          if mode == 2 and any(has_context(term, nearby) for term in entry.get("context", []))}
                if len(review) == 1 and reviews < 50 and len(suggestions) < 2:
                    term, entry = next(iter(review.items()))
                    suggestions.append({"termId": entry["id"], "original": match.group(), "candidate": term})
                    reviews += 1
                continue
            term, entry = next(iter(candidates.items()))
            if match.group() == term:
                continue
            pieces.extend((text[previous:match.start()], term)); previous = match.end()
            matched.append((match.start(), match.end()))
            corrections.append({"termId": entry["id"], "original": match.group(), "replacement": term, "method": "dictionary_alias"})
        pieces.append(text[previous:])
        # A typo that is merely similar to a known spelling must not change an answer.
        if reviews < 50 and len(suggestions) < 2:
            for token in re.finditer("[가-힣]{5,}", text):
                if any(a < token.end() and token.start() < b for a, b in protected + matched):
                    continue
                word = re.sub(r"(?:에서는|으로는|에서|으로|은|는|이|가|을|를|의)$", "", token.group())
                if key(word) in aliases:
                    continue
                scores = {}
                nearby_aliases = [candidate for length in (len(word) - 1, len(word), len(word) + 1)
                                  for candidate in fuzzy.get((word[0], length), [])]
                for alias, entry in nearby_aliases:
                    score = difflib.SequenceMatcher(None, alias, word, autojunk=False).ratio()
                    if score >= 0.88:
                        old = scores.get(entry["term"])
                        if old is None or score > old[0]:
                            scores[entry["term"]] = (score, entry)
                ranked = sorted(scores.items(), key=lambda item: item[1][0], reverse=True)
                if ranked and (len(ranked) == 1 or ranked[0][1][0] - ranked[1][1][0] >= 0.05):
                    term, (_, entry) = ranked[0]
                    suggestions.append({"termId": entry["id"], "original": word, "candidate": term})
                    reviews += 1
                if len(suggestions) >= 2 or reviews >= 50:
                    break
        fixed = "".join(pieces)
        updates = {"termCorrections": corrections, "termSuggestions": suggestions}
        if corrections:
            updates.update(text=fixed, originalText=text, words=[])
        output.append(segment.model_copy(update=updates))
        applied += len(corrections)
    return output, {"version": VERSION, "applied": applied, "review": reviews}
