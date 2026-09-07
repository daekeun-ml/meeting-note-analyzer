"""Programmatic verification and rendering for the mind-map stage (runs after the model and its reviewer subagent)."""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any

MAX_DEPTH = 4
MAX_CHILDREN = 14
MAX_LABEL = 60


def _ratio(done: int, total: int) -> float:
    return 1.0 if total == 0 else round(done / total, 2)


def check(data: dict, prior: dict[str, dict]) -> tuple[list[str], dict[str, float]]:
    """Return (problems, coverage) for a validated draft against the agenda and follow-up outputs."""
    nodes: list[dict[str, Any]] = data.get("nodes", [])
    problems: list[str] = []
    by_id = {n["id"]: n for n in nodes}
    if len(by_id) != len(nodes):
        problems.append("duplicate node ids")
    roots = [n for n in nodes if not n.get("parentId")]
    if len(roots) != 1:
        problems.append(f"expected exactly one root node, found {len(roots)}")
    for n in nodes:
        p = n.get("parentId")
        if p and p not in by_id:
            problems.append(f"{n['id']}: parentId {p} does not exist")

    def depth(nid: str, seen: tuple[str, ...] = ()) -> int:
        p = by_id[nid].get("parentId")
        if not p:
            return 1
        if p in seen or p not in by_id:
            return 99
        return 1 + depth(p, (*seen, nid))

    depths = [depth(n["id"]) for n in nodes]
    if any(d >= 99 for d in depths):
        problems.append("cycle in parentId chain")
    elif depths and max(depths) > MAX_DEPTH:
        problems.append(f"depth {max(depths)} exceeds {MAX_DEPTH}")
    for pid, count in Counter(n.get("parentId") for n in nodes if n.get("parentId")).items():
        if count > MAX_CHILDREN:
            problems.append(f"{pid} has {count} children (max {MAX_CHILDREN})")
    for n in nodes:
        if len(n.get("label", "")) > MAX_LABEL:
            problems.append(f"{n['id']}: label longer than {MAX_LABEL} characters")
    if not 8 <= len(nodes) <= 120:
        problems.append(f"{len(nodes)} nodes (expected between 8 and 120)")

    agenda_items = prior.get("agenda", {}).get("items", [])
    fu_items = prior.get("follow_ups", {}).get("items", [])
    agenda_ids = [a["id"] for a in agenda_items]
    fu_ids = [f["id"] for f in fu_items]
    refs = Counter(n.get("ref") for n in nodes if n.get("ref"))
    missing_a = [a for a in agenda_ids if refs.get(a, 0) == 0]
    dup_a = [a for a in agenda_ids if refs.get(a, 0) > 1]
    missing_f = [f for f in fu_ids if refs.get(f, 0) == 0]
    if missing_a:
        problems.append(f"agenda items missing from the map: {', '.join(missing_a)}")
    if dup_a:
        problems.append(f"agenda items referenced more than once: {', '.join(dup_a)}")
    if missing_f and len(missing_f) > len(fu_ids) // 5:
        problems.append(f"follow-ups missing from the map: {', '.join(missing_f)}")
    decisions_total = sum(len(a.get("decisions", [])) for a in agenda_items)
    decision_nodes = sum(1 for n in nodes if n.get("kind") == "decision")
    if decisions_total and decision_nodes == 0:
        problems.append("the agenda records decisions but the map has no decision nodes")
    coverage = {
        "agenda": _ratio(len(agenda_ids) - len(missing_a), len(agenda_ids)),
        "followUps": _ratio(len(fu_ids) - len(missing_f), len(fu_ids)),
        "decisions": _ratio(min(decision_nodes, decisions_total), decisions_total),
    }
    return problems, coverage


_MERMAID_STRIP = re.compile(r'[()\[\]{}"`#;<>|]')


def _mermaid_text(label: str) -> str:
    text = re.sub(r"\s+", " ", _MERMAID_STRIP.sub(" ", label)).strip()
    return text or "-"


def _children_map(nodes: list[dict]) -> tuple[dict | None, dict[str, list[dict]]]:
    root = next((n for n in nodes if not n.get("parentId")), None)
    children: dict[str, list[dict]] = defaultdict(list)
    for n in nodes:
        if n.get("parentId"):
            children[n["parentId"]].append(n)
    return root, children


def to_mermaid(nodes: list[dict]) -> str:
    """Mermaid `mindmap` text (indentation encodes hierarchy; labels are stripped of shape characters)."""
    root, children = _children_map(nodes)
    if root is None:
        return "mindmap\n  root((-))\n"
    lines = ["mindmap", f"  root(({_mermaid_text(root['label'])}))"]

    def walk(nid: str, indent: int, seen: set[str]) -> None:
        for c in children.get(nid, []):
            if c["id"] in seen:
                continue
            seen.add(c["id"])
            lines.append("  " * indent + f"{c['id']}({_mermaid_text(c['label'])})")
            walk(c["id"], indent + 1, seen)

    walk(root["id"], 2, {root["id"]})
    return "\n".join(lines) + "\n"


def to_outline(nodes: list[dict]) -> str:
    """Nested markdown list for viewers without Mermaid support."""
    root, children = _children_map(nodes)
    if root is None:
        return ""
    lines = [f"- {root['label']}"]

    def walk(nid: str, indent: int, seen: set[str]) -> None:
        for c in children.get(nid, []):
            if c["id"] in seen:
                continue
            seen.add(c["id"])
            lines.append("  " * indent + f"- {c['label']}")
            walk(c["id"], indent + 1, seen)

    walk(root["id"], 1, {root["id"]})
    return "\n".join(lines) + "\n"
