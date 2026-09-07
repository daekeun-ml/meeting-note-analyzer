"""Resolve recap references from authoritative outputs; reject missing sources before publication."""
from __future__ import annotations

from copy import deepcopy


def published_priors(doc: dict) -> dict:
    """Use the current published document when adding a brief to an older meeting."""
    return {
        "agenda": {"items": doc["agenda"]},
        "summary": doc["summary"],
        "notes": doc["notes"],
        "follow_ups": {"items": doc["followUps"]},
        "speaker_attribution": {"speakers": doc["speakers"]},
    }


def resolve(data: dict, prior: dict, segments: list[dict]) -> dict:
    """Reference validation is structural; the prompt must also verify the meaning of the cited discussion."""
    out = deepcopy(data)
    agenda = {a["id"]: a for a in prior["agenda"]["items"]}
    follow_ups = {f["id"]: f for f in prior["follow_ups"]["items"]}
    transcript = {s["id"]: s for s in segments}
    seen: set[tuple[str, int]] = set()
    for decision in out["decisions"]:
        ref = (decision["agendaId"], decision["decisionIndex"])
        choices = agenda.get(ref[0], {}).get("decisions", [])
        if ref in seen or not 0 <= ref[1] < len(choices):
            raise ValueError(f"invalid or repeated decision reference: {ref}")
        seen.add(ref)
        ids = decision["evidenceSegmentIds"]
        if len(set(ids)) != len(ids) or any(sid not in transcript for sid in ids):
            raise ValueError(f"invalid transcript evidence for decision: {ref}")
        if decision["rationaleStatus"] == "supported":
            if not ids or not decision["process"].strip():
                raise ValueError(f"supported rationale needs a process and transcript evidence: {ref}")
        else:
            decision["process"] = ""
        decision["decision"] = choices[ref[1]]
        decision["evidence"] = [
            {"segmentId": sid, "start": transcript[sid]["start"], "speaker": transcript[sid]["speaker"], "text": transcript[sid]["text"]}
            for sid in ids
        ]
    ids = out["followUpIds"]
    if len(set(ids)) != len(ids) or any(fid not in follow_ups for fid in ids):
        raise ValueError("invalid or repeated follow-up reference")
    seen.clear()
    for question in out["openQuestions"]:
        ref = (question["agendaId"], question["questionIndex"])
        choices = agenda.get(ref[0], {}).get("openQuestions", [])
        if ref in seen or not 0 <= ref[1] < len(choices):
            raise ValueError(f"invalid or repeated open question reference: {ref}")
        seen.add(ref)
        question["question"] = choices[ref[1]]
    out["omittedCounts"] = {
        "decisions": sum(len(a.get("decisions", [])) for a in agenda.values()) - len(out["decisions"]),
        "followUps": len(follow_ups) - len(out["followUpIds"]),
        "openQuestions": sum(len(a.get("openQuestions", [])) for a in agenda.values()) - len(out["openQuestions"]),
    }
    for field, available in (("decisions", out["omittedCounts"]["decisions"]), ("followUpIds", out["omittedCounts"]["followUps"])):
        if available > 0 and not out[field]:
            raise ValueError(f"select at least one important item for {field} from the detailed outputs")
    return out
