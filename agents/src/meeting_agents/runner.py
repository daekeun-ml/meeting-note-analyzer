"""Runs one pipeline stage: prepare workdir -> Claude Agent SDK query -> validate -> publish -> callback."""
from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import shutil
import threading
import time
from pathlib import Path
from typing import Any

import boto3
from claude_agent_sdk import AgentDefinition, ClaudeAgentOptions, ResultMessage, query

from . import brief, keys, memory, mindmap, quality, sanitize, tracing
from .config import CHUNK_MINUTES, DATA_BUCKET, PROMPTS_DIR, REGION, STAGE_BUDGET_USD, TABLE_NAME, WORK_ROOT, HEARTBEAT_SEC
from .payload import StagePayload
from .schemas import json_schema, validate
from .stages import SPECS, StageSpec, SubagentSpec
from .tools import TOOL_NAMES, build_server
from .transcript import Transcript, apply_attribution

log = logging.getLogger("agents.runner")

LANG_NAMES = {"ko": "Korean (한국어)", "en": "English", "ja": "Japanese", "zh": "Chinese", "auto": "the meeting's dominant language"}


MAX_ATTEMPTS = 3


class StageError(Exception):
    def __init__(self, message: str, transient: bool = False):
        super().__init__(message)
        self.transient = transient


class Heartbeat:
    """Sends Step Functions heartbeats; aborts the stage when the token is no longer valid."""

    def __init__(self, sfn, token: str | None):
        self.sfn, self.token = sfn, token
        self.stop = threading.Event()
        self.dead = threading.Event()

    def start(self) -> None:
        if not self.token:
            return
        threading.Thread(target=contextvars.copy_context().run, args=(self._loop,), name="heartbeat", daemon=True).start()

    def _loop(self) -> None:
        while not self.stop.wait(HEARTBEAT_SEC):
            try:
                self.sfn.send_task_heartbeat(taskToken=self.token)
            except self.sfn.exceptions.TaskTimedOut:
                log.error("task token timed out; aborting stage")
                self.dead.set()
                return
            except Exception as exc:  # noqa: BLE001
                name = type(exc).__name__
                if name in ("InvalidToken", "TaskDoesNotExist"):
                    self.dead.set()
                    return
                log.warning("heartbeat failed: %s", exc)


def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / name).read_text(encoding="utf-8")


def system_prompt(spec: StageSpec) -> str:
    """Pipeline ground rules + the stage role + the shared writing-style guide."""
    return "\n\n".join([load_prompt("_common.md"), load_prompt(spec.prompt_file), load_prompt("_style.md")])


def subagent_prompt(sub: SubagentSpec) -> str:
    return "\n\n".join([load_prompt(sub.prompt_file), load_prompt("_style.md")])


def prepare_workdir(s3, payload: StagePayload, spec: StageSpec) -> tuple[Path, Transcript]:
    workdir = WORK_ROOT / payload.meetingId / payload.stage
    if workdir.exists():
        shutil.rmtree(workdir)
    (workdir / "prior").mkdir(parents=True)
    tpath = workdir / "transcript.json"
    # Downstream of speaker attribution, use the attributed transcript when present.
    src_key = payload.transcriptKey
    if payload.stage not in ("transcript_analysis", "topic_segmentation", "speaker_attribution"):
        try:
            s3.head_object(Bucket=DATA_BUCKET, Key=keys.attributed_transcript(payload.meetingId))
            src_key = keys.attributed_transcript(payload.meetingId)
        except Exception:  # noqa: BLE001
            pass
    s3.download_file(DATA_BUCKET, src_key, str(tpath))
    transcript = Transcript.load(tpath)
    (workdir / "transcript.md").write_text(transcript.to_markdown(payload.title), encoding="utf-8")
    if spec.use_chunks:
        transcript.write_chunks(workdir / "chunks", CHUNK_MINUTES, payload.title)
    published = None
    if payload.stage == "meeting_brief" and payload.documentKey:
        dpath = workdir / "document.json"
        s3.download_file(DATA_BUCKET, payload.documentKey, str(dpath))
        document = json.loads(dpath.read_text(encoding="utf-8"))
        if document.get("meetingId") != payload.meetingId:
            raise StageError("published document belongs to a different meeting")
        published = brief.published_priors(document)
    for prior in spec.inputs:
        try:
            if published is not None:
                (workdir / "prior" / f"{prior}.json").write_text(json.dumps(published[prior], ensure_ascii=False, indent=2), encoding="utf-8")
                continue
            s3.download_file(DATA_BUCKET, keys.stage_result(payload.meetingId, prior), str(workdir / "prior" / f"{prior}.json"))
            if spec.name == "meeting_brief":
                # Long, single-line JSON is truncated by file-reading tools. Preserve readable source references.
                prior_path = workdir / "prior" / f"{prior}.json"
                prior_path.write_text(json.dumps(json.loads(prior_path.read_text(encoding="utf-8")), ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as exc:  # noqa: BLE001
            raise StageError(f"missing prior stage output {prior}: {exc}") from exc
    return workdir, transcript


def build_task_prompt(payload: StagePayload, spec: StageSpec, workdir: Path, transcript: Transcript, retry_note: str | None = None) -> str:
    lang = LANG_NAMES.get(payload.outputLanguage, payload.outputLanguage)
    files = ["transcript.md (full transcript, one segment per line: [time] speaker (segmentId): text)", "transcript.json (same, structured)"]
    if spec.use_chunks:
        files.append(f"chunks/chunk-NN.md ({CHUNK_MINUTES}-minute windows of the transcript)")
    files += [f"prior/{p}.json (output of the earlier '{p}' stage)" for p in spec.inputs]
    lines = [
        f"# Task: stage `{spec.name}` for meeting \"{payload.title}\"",
        "",
        f"- Working directory: {workdir}",
        f"- Meeting duration: {transcript.duration / 60:.1f} minutes, {len(transcript.segments)} segments, diarized speakers: {', '.join(s['id'] for s in transcript.data.get('speakers', []))}",
        f"- Detected language: {transcript.data.get('language')}",
        f"- OUTPUT LANGUAGE: write every human-readable field in {lang}. Keep ids, speaker ids and JSON keys as-is. Never translate quoted transcript evidence.",
        "",
        "## Files available (use Read / Grep / Glob on these; paths are relative to the working directory)",
        *[f"- {f}" for f in files],
        "",
        "## Deliverable",
        "Produce ONLY the structured JSON output defined by the output schema for this stage. Do not write files.",
    ]
    if spec.subagents:
        names = ", ".join(f"`{s.name}`" for s in spec.subagents)
        lines += ["", f"## Subagents", f"You may delegate per-chunk or per-topic work to these subagents via the Agent tool, running several in parallel: {names}. Always run them in the foreground (run_in_background=false) and wait for every report BEFORE producing the final JSON; the structured JSON must be the very last thing you do. Give each subagent the exact file path(s) or time window it must cover and ask for a compact report. You remain responsible for the final synthesis and the JSON."]
    if retry_note:
        lines += ["", "## Correction required", retry_note]
    return "\n".join(lines)


def build_options(payload: StagePayload, spec: StageSpec, workdir: Path, transcript: Transcript, server) -> ClaudeAgentOptions:
    agents = {
        s.name: AgentDefinition(
            description=s.description,
            prompt=subagent_prompt(s),
            tools=["Read", "Grep", "Glob", *TOOL_NAMES],
            model=s.model,
            maxTurns=s.max_turns,
            effort=s.effort,
            background=False,
        )
        for s in spec.subagents
    }
    return ClaudeAgentOptions(
        model=spec.model,
        effort=spec.effort,
        system_prompt=system_prompt(spec),
        cwd=str(workdir),
        permission_mode="bypassPermissions",
        setting_sources=[],
        tools=["Read", "Grep", "Glob", "Agent"] if spec.subagents else ["Read", "Grep", "Glob"],
        allowed_tools=["Read", "Grep", "Glob"] if spec.name == "meeting_brief" else ["Read", "Grep", "Glob", "Agent", *TOOL_NAMES],
        mcp_servers={} if spec.name == "meeting_brief" else {"meeting": server},
        agents=agents or None,
        max_turns=spec.max_turns,
        max_budget_usd=STAGE_BUDGET_USD,
        output_format={"type": "json_schema", "schema": json_schema(spec.name)},
    )


async def run_query(prompt: str, options: ClaudeAgentOptions, stage: str) -> tuple[dict | None, ResultMessage | None]:
    """Run the agent; prefer ResultMessage.structured_output but fall back to the last schema-valid tool input.

    When a background subagent replies after the lead has already submitted its structured output, the lead gets
    one more turn and the final result carries no structured_output. The StructuredOutput tool call is still in
    the stream, so keep the latest tool input that validates against the stage schema.
    """
    from claude_agent_sdk import AssistantMessage, ToolUseBlock

    result: ResultMessage | None = None
    captured: dict | None = None
    st = tracing.CURRENT.get()
    lead = st.agent_name if st else stage
    subagent_by_tool_use: dict[str, str] = {}  # Agent tool_use id -> subagent type, to attribute subagent turns
    last_ns = time.time_ns()
    async for message in query(prompt=prompt, options=options):
        now_ns = time.time_ns()
        if isinstance(message, AssistantMessage):
            for block in message.content:
                if isinstance(block, ToolUseBlock) and isinstance(block.input, dict):
                    if block.name == "Agent" and block.input.get("subagent_type"):
                        subagent_by_tool_use[block.id] = str(block.input["subagent_type"])
                    if _validate_or_none(stage, block.input, quiet=True):
                        captured = block.input
            if message.usage:
                tracing.record_llm_turn(message, start_ns=last_ns, end_ns=now_ns, agent_name=subagent_by_tool_use.get(message.parent_tool_use_id or "", lead))
        last_ns = now_ns
        if isinstance(message, ResultMessage):
            result = message
    if result is None:
        return captured, None
    return result.structured_output or captured, result


def run_stage(payload: StagePayload) -> dict[str, Any]:
    spec = SPECS[payload.stage]
    s3 = boto3.client("s3", region_name=REGION)
    sfn = boto3.client("stepfunctions", region_name=REGION)
    ddb = boto3.resource("dynamodb", region_name=REGION).Table(TABLE_NAME) if TABLE_NAME else None
    trace_ctx = tracing.StageTrace(stage=spec.name, meeting_id=payload.meetingId, user_id=payload.ownerSub, model=spec.model, subagent_models={a.name: a.model for a in spec.subagents})
    tracing.CURRENT.set(trace_ctx)
    hb = Heartbeat(sfn, payload.taskToken)
    hb.start()
    t0 = time.time()
    try:
        workdir, transcript = prepare_workdir(s3, payload, spec)
        server = build_server(actor_id=payload.ownerSub, session_id=payload.meetingId, transcript=transcript, workdir=workdir)
        options = build_options(payload, spec, workdir, transcript, server)
        validated: dict | None = None
        note: str | None = None
        for attempt in range(1, MAX_ATTEMPTS + 1):
            trace_ctx.attempt = attempt
            data, result = _query_with_retry(build_task_prompt(payload, spec, workdir, transcript, note), options, spec.name)
            validated, note = _accept(spec.name, data, result)
            if validated is not None and spec.name == "meeting_brief":
                try:
                    prior = {p: json.loads((workdir / "prior" / f"{p}.json").read_text(encoding="utf-8")) for p in spec.inputs}
                    validated = brief.resolve(sanitize.clean_output(validated), prior, transcript.segments)
                except ValueError as exc:
                    validated, note = None, f"Fix the recap references or missing rationale evidence: {exc}"
            if validated is not None:
                break
            log.warning("stage %s attempt %d rejected: %s", spec.name, attempt, note)
        if validated is None:
            raise StageError(f"stage output rejected after {MAX_ATTEMPTS} attempts: {note}")
        if spec.name != "meeting_brief":  # The resolved recap includes verbatim transcript quotes.
            validated = sanitize.clean_output(validated)
        if spec.name == "mindmap":
            validated = verify_mindmap(validated, workdir, lambda note: asyncio.run(run_query(build_task_prompt(payload, spec, workdir, transcript, note), options, spec.name)))
        if hb.dead.is_set():
            raise StageError("task token expired during processing", transient=False)
        out_key = keys.stage_result(payload.meetingId, spec.name)
        s3.put_object(Bucket=DATA_BUCKET, Key=out_key, Body=json.dumps(validated, ensure_ascii=False).encode("utf-8"), ContentType="application/json")
        if spec.name == "speaker_attribution":
            attributed = apply_attribution(transcript.data, validated)
            s3.put_object(Bucket=DATA_BUCKET, Key=keys.attributed_transcript(payload.meetingId), Body=json.dumps(attributed, ensure_ascii=False).encode("utf-8"), ContentType="application/json")
        memory.record_stage_note(payload.ownerSub, payload.meetingId, spec.name, stage_note(spec.name, validated))
        usage = {"costUsd": getattr(result, "total_cost_usd", None), "turns": getattr(result, "num_turns", None), "durationSec": round(time.time() - t0, 1)}
        if ddb is not None:
            _update_stage(ddb, payload.meetingId, spec.name, "COMPLETED", {"s3Key": out_key, "usage": {k: (str(v) if isinstance(v, float) else v) for k, v in usage.items()}})
        if payload.taskToken:
            sfn.send_task_success(taskToken=payload.taskToken, output=json.dumps({"stage": spec.name, "s3Key": out_key, "usage": usage}))
        log.info("stage %s done for %s: %s", spec.name, payload.meetingId, usage)
        return {"s3Key": out_key, "usage": usage}
    except Exception as exc:  # noqa: BLE001
        log.exception("stage %s failed", payload.stage)
        transient = isinstance(exc, StageError) and exc.transient or _looks_transient(exc)
        if ddb is not None:
            _update_stage(ddb, payload.meetingId, spec.name, "FAILED", {"error": str(exc)[:1000]})
        if payload.taskToken and not hb.dead.is_set():
            try:
                sfn.send_task_failure(taskToken=payload.taskToken, error="AgentTransient" if transient else "AgentStageFailed", cause=str(exc)[:32000])
            except Exception as cb:  # noqa: BLE001
                log.warning("send_task_failure failed: %s", cb)
        raise
    finally:
        hb.stop.set()


def verify_mindmap(validated: dict, workdir: Path, rerun) -> dict:
    """Check coverage/structure against the prior outputs; give the agent one correction pass, then record what is left."""
    prior = {}
    for name in ("agenda", "follow_ups"):
        path = workdir / "prior" / f"{name}.json"
        if path.exists():
            prior[name] = json.loads(path.read_text(encoding="utf-8"))
    problems, coverage = mindmap.check(validated, prior)
    if problems:
        log.warning("mind map verification found %d problems; requesting a correction: %s", len(problems), problems)
        note = "Programmatic verification of your mind map failed. Fix ALL of the following and return the complete JSON again:\n- " + "\n- ".join(problems)
        data, _ = rerun(note)
        retried = _validate_or_none("mindmap", data)
        if retried is not None:
            retried = sanitize.clean_output(retried)
            new_problems, new_coverage = mindmap.check(retried, prior)
            if len(new_problems) <= len(problems):
                validated, problems, coverage = retried, new_problems, new_coverage
    review = validated.setdefault("review", {"verdict": "pass", "findings": []})
    review.setdefault("findings", []).extend(f"unresolved: {p}" for p in problems)
    validated["coverage"] = coverage
    validated["mermaid"] = mindmap.to_mermaid(validated["nodes"])
    validated["outline"] = mindmap.to_outline(validated["nodes"])
    return validated


def _accept(stage: str, data: dict | None, result) -> tuple[dict | None, str | None]:
    """Schema validation plus content sanity checks; returns (output, correction note for the next attempt)."""
    if data is None:
        return None, f"The previous attempt ended without structured output (result subtype: {getattr(result, 'subtype', '?')}). Do the analysis, then call the structured output tool exactly once with the complete JSON."
    validated = _validate_or_none(stage, data)
    if validated is None:
        return None, "The previous attempt returned JSON that failed schema validation. Return the complete JSON exactly matching the schema."
    issues = quality.problems(stage, validated)
    if issues:
        return None, "The previous attempt was rejected because it did not contain real content: " + "; ".join(issues) + ". Read the inputs, do the full analysis, and call the structured output tool exactly once with every field filled from the transcript and prior outputs. Never submit drafts or placeholder values."
    return validated, None


def _validate_or_none(stage: str, data: dict | None, quiet: bool = False) -> dict | None:
    if not data:
        return None
    try:
        return validate(stage, data)
    except Exception as exc:  # noqa: BLE001
        if not quiet:
            log.warning("schema validation failed for %s: %s", stage, exc)
        return None


TRANSIENT_MARKERS = (
    "throttl", "rate limit", "too many requests", "503", "502", "500", "timeout", "temporarily", "unexpected error",
    "try your request again", "internal server error", "service unavailable", "serviceunavailable", "modelerror",
    "connection reset", "econnreset", "overloaded", "api error",
)
API_RETRY_DELAYS_SEC = (20, 60)


def _looks_transient(exc: Exception) -> bool:
    s = str(exc).lower()
    return any(k in s for k in TRANSIENT_MARKERS)


def _query_with_retry(prompt: str, options: ClaudeAgentOptions, stage: str):
    """Run the agent; retry in place when the model API fails transiently (Bedrock 5xx surfaces as a CLI error result)."""
    for i, delay in enumerate((*API_RETRY_DELAYS_SEC, None)):
        try:
            return asyncio.run(run_query(prompt, options, stage))
        except Exception as exc:  # noqa: BLE001
            if delay is None or not _looks_transient(exc):
                raise
            log.warning("transient model/API error on attempt %d for %s, retrying in %ss: %s", i + 1, stage, delay, str(exc)[:300])
            time.sleep(delay)
    raise AssertionError("unreachable")


def _update_stage(table, meeting_id: str, stage: str, status: str, extra: dict) -> None:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    patch = {"status": status, "endedAt": now, **extra}
    try:
        table.update_item(
            Key={"PK": f"MEETING#{meeting_id}", "SK": "META"},
            UpdateExpression="SET #stages.#stage = :patch, #updatedAt = :now",
            ExpressionAttributeNames={"#stages": "stages", "#stage": stage, "#updatedAt": "updatedAt"},
            ExpressionAttributeValues={":patch": patch, ":now": now},
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("stage status update failed: %s", exc)


def stage_note(stage: str, data: dict) -> str:
    """Compact human-readable note for short-term memory."""
    if stage == "topic_segmentation":
        return f"{data.get('meetingType')}: {data.get('purpose')}. Topics: " + "; ".join(f"{t['id']} {t['title']}" for t in data.get("topics", []))
    if stage == "speaker_attribution":
        return "Speakers: " + "; ".join(f"{s['id']}={s['label']}" + (f" ({s['role']})" if s.get("role") else "") for s in data.get("speakers", []))
    if stage == "agenda":
        return "Agenda: " + "; ".join(f"{a['id']} {a['title']}" for a in data.get("items", []))
    if stage == "summary":
        return f"Summary: {data.get('headline')}: {data.get('overview', '')[:1500]}"
    if stage == "meeting_brief":
        return f"Meeting brief: {data.get('headline')}"
    if stage == "follow_ups":
        return "Follow-ups: " + "; ".join(f"{f['title']} (owner {f.get('ownerName') or f.get('ownerSpeakerId') or '?'}, {f['priority']})" for f in data.get("items", []))
    if stage == "mindmap":
        cov = data.get("coverage", {})
        return f"Mind map: {len(data.get('nodes', []))} nodes, coverage agenda {cov.get('agenda')}, follow-ups {cov.get('followUps')}, decisions {cov.get('decisions')}"
    if stage == "transcript_analysis":
        return f"Primary language {data.get('primaryLanguage')}, quality {data.get('quality', {}).get('overall')}, glossary: " + ", ".join(g["term"] for g in data.get("glossary", [])[:40])
    return json.dumps(data, ensure_ascii=False)[:1500]
