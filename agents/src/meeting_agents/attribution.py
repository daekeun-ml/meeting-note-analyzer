"""Conservative application of contextual speaker proposals, without changing speech.

Confidence is a model self-assessment, not a measured probability. It is only one
gate: explicit identity evidence, source references and structural checks must
also pass. Ambiguous proposals remain available for human review.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from copy import deepcopy
from typing import Any

MIN_CONFIDENCE = 0.85


def _normalized(text: str) -> str:
    return " ".join(text.split())


def reconcile_attribution(transcript: dict[str, Any], draft: dict[str, Any]) -> tuple[dict, dict]:
    segments = transcript["segments"]
    by_id = {s["id"]: s for s in segments}
    ids = {s["speaker"] for s in segments}
    by_speaker: dict[str, list[dict]] = defaultdict(list)
    for seg in segments:
        by_speaker[seg["speaker"]].append(seg)
    corrections: list[dict] = []

    def inspect(proposal: dict, required_speakers: set[str], segment_id: str | None = None) -> tuple[list[str], list[dict]]:
        issues = []
        if proposal.get("decision") != "confirmed":
            issues.append("unconfirmed")
        if proposal.get("basis") != "explicit_identity":
            issues.append("context_only")
        if proposal.get("confidence", 0) < MIN_CONFIDENCE:
            issues.append("low_confidence")
        support = proposal.get("support", [])
        verified = [e for e in support if e["segmentId"] in by_id and _normalized(e["quote"])
                    and _normalized(e["quote"]) in _normalized(by_id[e["segmentId"]]["text"])]
        if len(verified) != len(support):
            issues.append("invalid_evidence")
        supported_speakers = {by_id[e["segmentId"]]["speaker"] for e in verified}
        if not verified or not required_speakers.issubset(supported_speakers):
            issues.append("missing_evidence")
        if segment_id and not any(e["segmentId"] == segment_id for e in verified):
            issues.append("missing_segment_evidence")
        return issues, deepcopy(verified)

    def record(kind: str, proposal: dict, sources: list[str], affected: list[str], issues: list[str], evidence: list[dict]) -> dict:
        correction = {
            "id": f"speaker-correction-{len(corrections) + 1:04d}",
            "kind": kind, "from": sources, "to": proposal.get("to", proposal.get("id", "")),
            "status": "review_required" if issues else "applied",
            "reason": proposal.get("reason") or "",
            "issues": list(dict.fromkeys(issues)), "evidence": evidence,
            "segmentIds": affected,
        }
        if kind == "label":
            correction["proposedLabel"] = proposal["label"]
        corrections.append(correction)
        return correction

    merges = draft.get("merges", [])
    relabels = draft.get("relabels", [])
    source_counts = Counter(src for m in merges for src in m.get("from", []))
    relabel_counts = Counter(r["segmentId"] for r in relabels)
    merge_map: dict[str, str] = {}
    accepted_merges = []
    # Chained, cyclic and intersecting proposals need a single unambiguous proposal
    # from the model. Do not make the result depend on the ordering of proposals.
    for proposal in merges:
        sources, target = proposal["from"], proposal["to"]
        involved = set(sources) | {target}
        issues, evidence = inspect(proposal, involved)
        if not sources or not involved.issubset(ids) or target in sources:
            issues.append("invalid_speaker")
        if (any(source_counts[src] != 1 for src in sources) or target in source_counts
                or any(other is not proposal and involved.intersection([*other["from"], other["to"]]) for other in merges)):
            issues.append("conflicting_proposals")
        if any(r["from"] in involved or r["to"] in involved for r in relabels):
            issues.append("conflicting_proposals")
        # Two labels speaking simultaneously are not reliable merge candidates.
        intervals = sorted((s["start"], s["end"], s["speaker"]) for src in involved for s in by_speaker[src])
        ends: dict[str, float] = {}
        for start, end, speaker in intervals:
            if any(other != speaker and previous_end - start > 0.1 for other, previous_end in ends.items()):
                issues.append("overlapping_speech")
                break
            ends[speaker] = max(ends.get(speaker, end), end)
        affected = [s["id"] for s in segments if s["speaker"] in sources]
        record("merge", proposal, sources, affected, issues, evidence)
        if not issues:
            merge_map.update({src: target for src in sources})
            accepted_merges.append(deepcopy(proposal))

    relabel_map = {}
    accepted_relabels = []
    merge_involved = {src for m in merges for src in [*m["from"], m["to"]]}
    for proposal in relabels:
        segment_id, source, target = proposal["segmentId"], proposal["from"], proposal["to"]
        issues, evidence = inspect(proposal, {target}, segment_id)
        segment = by_id.get(segment_id)
        if not segment:
            issues.append("invalid_segment")
        elif segment["speaker"] != source:
            issues.append("source_mismatch")
        if source not in ids or target not in ids or source == target:
            issues.append("invalid_speaker")
        if relabel_counts[segment_id] != 1 or source in merge_involved or target in merge_involved:
            issues.append("conflicting_proposals")
        record("relabel", proposal, [source], [segment_id] if segment else [], issues, evidence)
        if not issues:
            relabel_map[segment_id] = target
            accepted_relabels.append(deepcopy(proposal))

    out = deepcopy(transcript)
    for seg in out["segments"]:
        original = seg["speaker"]
        seg["originalSpeaker"] = original
        seg["speaker"] = relabel_map.get(seg["id"], merge_map.get(original, original))

    effective_ids = {s["speaker"] for s in out["segments"]}
    candidates: dict[str, list[dict]] = defaultdict(list)
    for speaker in draft.get("speakers", []):
        candidates[speaker["id"]].append(speaker)
    labels: dict[str, dict] = {}
    for speaker_id in sorted(effective_ids):
        proposals = candidates.get(speaker_id, [])
        info = {"id": speaker_id, "label": speaker_id, "confidence": 0, "evidence": [], "reviewRequired": False}
        for proposal in proposals:
            label = proposal["label"].strip()
            # Anonymous labels do not claim an identity and need no name review.
            neutral = {speaker_id, f"Speaker {speaker_id.removeprefix('S')}", f"화자 {speaker_id.removeprefix('S')}"}
            if label in neutral and not proposal.get("name") and not proposal.get("role"):
                continue
            proposal = {**proposal, "label": label}
            issues, evidence = inspect(proposal, {speaker_id})
            if len(proposals) != 1:
                issues.append("conflicting_proposals")
            if any(other != speaker_id and other in effective_ids and any(p["label"].strip() == label for p in values)
                   for other, values in candidates.items()):
                issues.append("ambiguous_identity")
            if not label:
                issues.append("invalid_label")
            affected = [s["id"] for s in out["segments"] if s["speaker"] == speaker_id]
            correction = record("label", proposal, [speaker_id], affected, issues, evidence)
            if issues:
                info.update(reviewRequired=True, proposedLabel=label, reviewReason=", ".join(correction["issues"]))
            else:
                info = {**deepcopy(proposal), "reviewRequired": False}
        labels[speaker_id] = info

    # An invented speaker ID must not become a participant or disappear silently.
    for speaker_id, proposals in candidates.items():
        if speaker_id not in ids:
            for proposal in proposals:
                record("label", proposal, [speaker_id], [], ["invalid_speaker"], [])

    segment_corrections: dict[str, list[dict]] = defaultdict(list)
    for correction in corrections:
        for segment_id in correction["segmentIds"]:
            segment_corrections[segment_id].append(correction)
    talk: dict[str, float] = defaultdict(float)
    for seg in out["segments"]:
        seg["speakerLabel"] = labels[seg["speaker"]]["label"]
        seg["speakerCorrectionIds"] = [c["id"] for c in segment_corrections[seg["id"]]]
        seg["speakerReviewRequired"] = any(c["status"] == "review_required" for c in segment_corrections[seg["id"]])
        talk[seg["speaker"]] += max(0, seg["end"] - seg["start"])
    out["speakers"] = [{**labels[k], "talkTimeSec": round(v, 1)} for k, v in sorted(talk.items(), key=lambda kv: -kv[1])]
    out["attributed"] = True
    out["speakerAttribution"] = {"version": 2, "corrections": corrections}
    safe = {
        "speakers": [labels[s["id"]] for s in out["speakers"]],
        "merges": accepted_merges, "relabels": accepted_relabels,
        "reviewItems": [c for c in corrections if c["status"] == "review_required"],
        "notes": draft.get("notes", ""),
    }
    return safe, out
