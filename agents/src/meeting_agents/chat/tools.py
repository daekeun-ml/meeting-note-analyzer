"""In-process MCP tools for the chat agent. Every tool checks ownership and appends structured evidence to the turn."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from claude_agent_sdk import create_sdk_mcp_server, tool

from . import gateway, memory
from .config import DATA_BUCKET, LECTURE_TABLE_NAME, MAX_RESULTS, REGION, TABLE_NAME, WEB_ORIGIN
from .evidence import diversify, format_for_model, locate_lecture_pages, to_evidence

log = logging.getLogger("chat.tools")

TOOL_NAMES = [
    "mcp__meeting__search_meetings",
    "mcp__meeting__get_meeting",
    "mcp__meeting__list_meetings",
    "mcp__meeting__get_transcript_window",
    "mcp__meeting__list_lectures",
    "mcp__meeting__get_lecture",
    "mcp__meeting__memory_facts",
    "mcp__meeting__ask_user",
]


@dataclass
class TurnContext:
    sub: str
    meeting_id: str | None = None
    evidence: list[dict[str, Any]] = field(default_factory=list)
    new_evidence: list[dict[str, Any]] = field(default_factory=list)  # drained by the streamer after each tool call
    clarify: dict[str, Any] | None = None  # set by ask_user: the turn ends with a question and tappable options
    documents: dict[str, dict[str, Any]] = field(default_factory=dict)  # lecture documents read this turn (page lookup for evidence)

    def add(self, items: list[dict[str, Any]]) -> None:
        self.evidence.extend(items)
        self.new_evidence.extend(items)


def _text(payload: Any) -> dict:
    return {"content": [{"type": "text", "text": payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)}]}


def _ddb():
    return boto3.resource("dynamodb", region_name=REGION).Table(TABLE_NAME)


def _s3():
    return boto3.client("s3", region_name=REGION)


def _owned_meeting(ctx: TurnContext, meeting_id: str) -> dict | None:
    rec = _ddb().get_item(Key={"PK": f"MEETING#{meeting_id}", "SK": "META"}).get("Item")
    if not rec or rec.get("owner") != ctx.sub:
        return None
    return rec


def _completed_meetings(sub: str, limit: int = 4) -> list[dict]:
    res = _ddb().query(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(f"USER#{sub}"), ScanIndexForward=False, Limit=25)
    done = [m for m in res.get("Items", []) if m.get("SK") == "META" and m.get("status") == "COMPLETED"]
    return [{"meetingId": m.get("meetingId"), "title": m.get("title"), "date": (m.get("createdAt") or "")[:10]} for m in done[:limit]]


def _lectures():
    return boto3.resource("dynamodb", region_name=REGION).Table(LECTURE_TABLE_NAME)


def _owned_lecture(ctx: TurnContext, lecture_id: str) -> dict | None:
    rec = _lectures().get_item(Key={"PK": f"MEETING#{lecture_id}", "SK": "META"}).get("Item")
    if not rec or rec.get("owner") != ctx.sub:
        return None
    return rec


def _lecture_row(m: dict) -> dict:
    return {"lectureId": m.get("lectureId"), "title": m.get("title"), "course": m.get("course") or "", "date": (m.get("createdAt") or "")[:10], "pageCount": int(m.get("pageCount") or 0), "durationMin": round(float(m.get("durationSec") or 0) / 60)}


def _completed_lectures(sub: str, limit: int = 4) -> list[dict]:
    res = _lectures().query(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(f"USER#{sub}"), ScanIndexForward=False, Limit=25)
    done = [m for m in res.get("Items", []) if m.get("SK") == "META" and m.get("status") == "COMPLETED"]
    return [_lecture_row(m) for m in done[:limit]]


def _lecture_document(ctx: TurnContext, lecture_id: str) -> dict | None:
    """The owner's published study document, read at most once per turn."""
    if lecture_id not in ctx.documents:
        rec = _owned_lecture(ctx, lecture_id)
        ctx.documents[lecture_id] = (_read_json(rec["documentKey"]) if rec and rec.get("documentKey") else None) or {}
    return ctx.documents[lecture_id]


def compact_lecture(doc: dict, lecture_id: str, page: int | None = None) -> dict:
    """Outline of a lecture study document, or one section in full (its summaries, math notes, questions and cards)."""
    pages = doc.get("pages", [])
    if page is None:
        audience = doc.get("audience") or {}
        return {
            "lectureId": lecture_id, "title": doc.get("title"), "course": doc.get("course"), "audienceLevel": audience.get("level"),
            "overview": (doc.get("overview") or "")[:1500], "learningObjectives": doc.get("learningObjectives", [])[:10], "reviewPlan": doc.get("reviewPlan", [])[:10],
            "pages": [{"page": p.get("page"), "title": p.get("title"), "startSec": (p.get("videoRanges") or [{}])[0].get("startSec")} for p in pages],
        }
    match = next((p for p in pages if p.get("page") == page), None)
    if not match:
        return {"error": "page not found", "pages": [p.get("page") for p in pages]}
    return {"lectureId": lecture_id, "title": doc.get("title"), "page": {
        "page": match.get("page"), "title": match.get("title"), "startSec": (match.get("videoRanges") or [{}])[0].get("startSec"),
        "slideSummary": match.get("slideSummary"), "spokenSummary": match.get("spokenSummary"), "explanation": (match.get("explanation") or "")[:2000],
        "concepts": match.get("concepts", []),
        "mathNotes": [{k: n.get(k) for k in ("kind", "name", "statement", "steps", "intuition", "supplementary")} for n in match.get("mathNotes", [])],
        "reviewQuestions": match.get("reviewQuestions", []), "flashcards": match.get("flashcards", []),
    }}


def _read_json(key: str) -> dict | None:
    try:
        body = _s3().get_object(Bucket=DATA_BUCKET, Key=key)["Body"].read()
        return json.loads(body)
    except Exception as exc:  # noqa: BLE001
        log.info("read %s failed: %s", key, exc)
        return None


def compact_document(doc: dict, meeting_id: str) -> dict:
    """The parts of a final document a chat answer needs, with stable ids for citations."""
    return {
        "meetingId": meeting_id,
        "title": doc.get("title"),
        "date": (doc.get("generatedAt") or "")[:10],
        "meetingType": doc.get("meetingType"),
        "speakers": [{"id": s.get("id"), "label": s.get("label"), "role": s.get("role")} for s in doc.get("speakers", [])],
        "headline": (doc.get("summary") or {}).get("headline"),
        "overview": (doc.get("summary") or {}).get("overview"),
        "keyDecisions": (doc.get("summary") or {}).get("keyDecisions", []),
        "risksAndIssues": (doc.get("summary") or {}).get("risksAndIssues", []),
        "agenda": [{"id": a.get("id"), "title": a.get("title"), "decisions": a.get("decisions", []), "openQuestions": a.get("openQuestions", []), "discussionPoints": a.get("discussionPoints", [])[:6]} for a in doc.get("agenda", [])],
        "followUps": [{"id": f.get("id"), "title": f.get("title"), "owner": f.get("ownerName"), "due": f.get("dueHint"), "priority": f.get("priority")} for f in doc.get("followUps", [])],
        "suggestions": [{"id": s.get("id"), "target": (s.get("target") or {}).get("title"), "suggestion": (s.get("suggestion") or "")[:400]} for s in doc.get("suggestions", [])[:6]],
        "brief": compact_brief(doc.get("brief")),
    }


def compact_brief(brief: dict | None) -> dict | None:
    """The at-a-glance recap when the meeting has one; unsupported decision reasons are never passed on."""
    if not brief:
        return None
    return {
        "headline": brief.get("headline"),
        "decisions": [{"decision": d.get("decision"), "rationaleStatus": d.get("rationaleStatus"), "process": d.get("process") if d.get("rationaleStatus") == "supported" else ""} for d in brief.get("decisions", [])],
        "followUpIds": brief.get("followUpIds", []),
        "openQuestions": [q.get("question") for q in brief.get("openQuestions", [])],
    }


def _speaker_namer(doc: dict | None, attribution: dict | None):
    """Map raw diarization ids (S1, S2) to the display names the speaker_attribution stage decided, honoring merges and per-segment relabels."""
    labels = {sp.get("id"): sp.get("label") or sp.get("id") for sp in (doc or {}).get("speakers", [])}
    merged = {src: m.get("to") for m in (attribution or {}).get("merges", []) for src in m.get("from", [])}
    relabel = {r.get("segmentId"): r.get("to") for r in (attribution or {}).get("relabels", [])}

    def name(seg: dict) -> str:
        sid = relabel.get(seg.get("id")) or merged.get(seg.get("speaker"), seg.get("speaker"))
        return str(labels.get(sid, sid))

    return name


def build_server(ctx: TurnContext):
    @tool("search_meetings", "Hybrid search over this user's meeting documents, transcripts and lecture study notes (managed knowledge base). Returns passages labeled [E#] that you must cite. Use a focused query; optionally restrict to one meetingId.", {"query": str, "meetingId": str})
    async def search_meetings(args: dict) -> dict:
        meeting_id = args.get("meetingId") or ctx.meeting_id
        # Ask for more than we show, then cap chunks per document: a single long meeting used to fill all 8 slots.
        results = gateway.retrieve(str(args["query"]), sub=ctx.sub, meeting_id=meeting_id or None, k=MAX_RESULTS + 4)
        items = to_evidence(diversify(results, per_document=3 if not meeting_id else MAX_RESULTS, limit=MAX_RESULTS), web_origin=WEB_ORIGIN, start_index=len(ctx.evidence))
        locate_lecture_pages(items, lambda lid: _lecture_document(ctx, lid))
        ctx.add(items)
        return _text(format_for_model(items))

    @tool("get_meeting", "Structured summary of one meeting the user owns: headline, agenda with decisions and open questions, follow-ups with owners, speakers, suggestions, and the at-a-glance brief (core outcome, decision rationale) when present. Adds one evidence entry [E#] for the document.", {"meetingId": str})
    async def get_meeting(args: dict) -> dict:
        mid = str(args["meetingId"])
        rec = _owned_meeting(ctx, mid)
        if not rec:
            return _text({"error": "meeting not found"})
        if not rec.get("notesKey"):
            return _text({"error": "analysis not finished", "status": rec.get("status")})
        doc = _read_json(rec["notesKey"])
        if not doc:
            return _text({"error": "document unavailable"})
        compact = compact_document(doc, mid)
        label = f"E{len(ctx.evidence) + 1}"
        ctx.add([{"id": label, "source": "document", "kind": "document", "meetingId": mid, "title": compact["title"], "date": compact["date"], "meetingType": compact["meetingType"], "snippet": compact.get("headline") or "", "score": None, "startSec": None, "segmentIds": [], "url": f"{WEB_ORIGIN}/meetings/{mid}"}])
        return _text({"evidenceLabel": label, **compact})

    @tool("list_meetings", "List this user's meetings (newest first): meetingId, title, date, type, status. Use it when the user refers to a meeting without naming it.", {"limit": int})
    async def list_meetings(args: dict) -> dict:
        limit = max(1, min(int(args.get("limit") or 20), 50))
        res = _ddb().query(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(f"USER#{ctx.sub}"), ScanIndexForward=False, Limit=limit)
        items = [{"meetingId": m.get("meetingId"), "title": m.get("title"), "date": (m.get("createdAt") or "")[:10], "status": m.get("status"), "durationMin": int(float(m.get("durationSec") or 0) // 60)} for m in res.get("Items", []) if m.get("SK") == "META" and m.get("status") == "COMPLETED"]
        return _text({"meetings": items})

    @tool("get_transcript_window", "Verbatim transcript lines (speaker, time, text) of one meeting between startSec and endSec (max 10 minutes). Adds an evidence entry [E#].", {"meetingId": str, "startSec": int, "endSec": int})
    async def get_transcript_window(args: dict) -> dict:
        mid = str(args["meetingId"])
        rec = _owned_meeting(ctx, mid)
        if not rec or not rec.get("transcriptKey"):
            return _text({"error": "transcript not found"})
        start, end = max(0, int(args["startSec"])), int(args["endSec"])
        end = min(end, start + 600)
        data = _read_json(rec["transcriptKey"])
        if not data:
            return _text({"error": "transcript unavailable"})
        name = _speaker_namer(_read_json(rec["notesKey"]) if rec.get("notesKey") else None, _read_json(f"results/{mid}/speaker_attribution.json"))
        segs = [s for s in data.get("segments", []) if s.get("end", 0) >= start and s.get("start", 0) <= end]
        lines = [f"[{int(s['start']) // 60:02d}:{int(s['start']) % 60:02d}] {name(s)}: {s.get('text')}" for s in segs[:200]]
        label = f"E{len(ctx.evidence) + 1}"
        ctx.add([{"id": label, "source": "transcript", "kind": "transcript", "meetingId": mid, "title": rec.get("title"), "date": (rec.get("createdAt") or "")[:10], "meetingType": None, "snippet": " ".join(lines)[:420], "score": None, "startSec": start, "segmentIds": [s.get("id") for s in segs[:5] if s.get("id")], "url": f"{WEB_ORIGIN}/meetings/{mid}?t={start}"}])
        return _text({"evidenceLabel": label, "lines": lines})

    @tool("list_lectures", "List this user's analyzed lectures (newest first): lectureId, title, course, date, pageCount. Use it when the user refers to a lecture or class without naming it.", {"limit": int})
    async def list_lectures(args: dict) -> dict:
        limit = max(1, min(int(args.get("limit") or 20), 50))
        return _text({"lectures": _completed_lectures(ctx.sub, limit=limit)})

    @tool("get_lecture", "One lecture the user owns. Without page: outline (audience level, overview, objectives, review plan, page titles). With page: that section's slide and speech summaries, explanation, concepts, math notes with steps, review questions and flashcards. Adds one evidence entry [E#].", {"lectureId": str, "page": int})
    async def get_lecture(args: dict) -> dict:
        lid = str(args["lectureId"])
        rec = _owned_lecture(ctx, lid)
        if not rec:
            return _text({"error": "lecture not found"})
        if rec.get("status") != "COMPLETED" or not rec.get("documentKey"):
            return _text({"error": "analysis not finished", "status": rec.get("status")})
        doc = _read_json(rec["documentKey"])
        if not doc:
            return _text({"error": "document unavailable"})
        page = int(args["page"]) if args.get("page") else None
        compact = compact_lecture(doc, lid, page)
        if "error" in compact:
            return _text(compact)
        label = f"E{len(ctx.evidence) + 1}"
        snippet = (compact["page"]["slideSummary"] if page else compact["overview"]) or ""
        ctx.add([{"id": label, "source": "document", "kind": "lecture", "meetingId": None, "lectureId": lid, "page": page, "title": doc.get("title"), "date": (rec.get("createdAt") or "")[:10], "meetingType": None, "snippet": snippet[:420], "score": None, "startSec": None, "segmentIds": [], "url": f"{WEB_ORIGIN}/lectures/{lid}" + (f"?page={page}" if page else "")}])
        return _text({"evidenceLabel": label, **compact})

    @tool("memory_facts", "Long-term facts remembered about this user's past meetings (people, roles, projects, decisions). Use for context, not as the only evidence.", {"query": str})
    async def memory_facts(args: dict) -> dict:
        return _text({"facts": memory.user_facts(ctx.sub, str(args["query"]))})

    @tool("ask_user", "Ask the user a clarifying question when their request is too broad or ambiguous to answer well. kind: 'meeting' when the user must pick a meeting, 'lecture' when they must pick a lecture (options are then filled from their real list, ignore yours), otherwise 'topic' or 'period' with 2 to 4 short options of your own. After calling this, reply with only the returned question and options, then stop.", {"question": str, "kind": str, "options": list})
    async def ask_user(args: dict) -> dict:
        question = str(args.get("question") or "").strip()
        kind = str(args.get("kind") or "topic")
        if not question:
            return _text({"error": "question required"})
        if kind == "meeting":
            # Never let the model invent meeting names: choices come from the user's finished meetings, newest first.
            options = [f"{m['title']} ({m['date']})" for m in _completed_meetings(ctx.sub, limit=4)]
            if not options:
                return _text({"error": "no finished meetings", "instruction": "Tell the user no analyzed meeting exists yet."})
        elif kind == "lecture":
            options = [f"{m['title']} ({m['date']})" for m in _completed_lectures(ctx.sub, limit=4)]
            if not options:
                return _text({"error": "no finished lectures", "instruction": "Tell the user no analyzed lecture exists yet."})
        else:
            options = [str(o).strip() for o in (args.get("options") or []) if str(o).strip()][:4]
        ctx.clarify = {"question": question, "options": options}
        return _text({"ok": True, "instruction": "Reply with only this question in one or two friendly sentences, naming only these options, and stop.", "question": question, "options": options})

    return create_sdk_mcp_server(name="meeting", version="1.0.0", tools=[search_meetings, get_meeting, list_meetings, get_transcript_window, list_lectures, get_lecture, memory_facts, ask_user])
