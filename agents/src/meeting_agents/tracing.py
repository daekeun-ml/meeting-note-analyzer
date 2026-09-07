"""Per-agent tracing on top of the OpenInference Claude Agent SDK instrumentation.

The instrumentor names every lead run ``ClaudeAgentSDK.query`` and every subagent ``ClaudeAgentSDK.Agent``, so the
AgentCore / CloudWatch GenAI console cannot tell stages or subagent types apart. This module

* renames those spans to ``invoke_agent <agent>`` and stamps GenAI semantic-convention attributes
  (gen_ai.agent.name, gen_ai.request.model, meeting.id, user.id, stage) on every span of a stage, and
* emits one ``chat <model>`` LLM span per assistant turn with token usage, attributed to the lead or the subagent
  that produced it (the model calls themselves happen inside the Claude Code subprocess and are otherwise invisible).
"""
from __future__ import annotations

import contextvars
import json
import logging
import os
import threading
from dataclasses import dataclass, field
from typing import Any

from opentelemetry import trace
from opentelemetry.sdk.trace import SpanProcessor

log = logging.getLogger("agents.tracing")

AGENT_NAMES = {
    "transcript_analysis": "transcript-analyst",
    "topic_segmentation": "topic-segmenter",
    "speaker_attribution": "speaker-attributor",
    "agenda": "agenda-builder",
    "summary": "meeting-summarizer",
    "notes": "note-writer",
    "follow_ups": "followup-tracker",
    "suggestions": "advisor",
    "mindmap": "mindmap-builder",
    "meeting_brief": "meeting-brief-writer",
    "chat": "meeting-chat",
}


@dataclass
class StageTrace:
    stage: str
    meeting_id: str
    user_id: str
    model: str
    subagent_models: dict[str, str] = field(default_factory=dict)
    attempt: int = 1

    @property
    def agent_name(self) -> str:
        return AGENT_NAMES.get(self.stage, self.stage)


CURRENT: contextvars.ContextVar[StageTrace | None] = contextvars.ContextVar("meeting_agents.stage_trace", default=None)


def resolve_model(alias: str) -> str:
    """Map Claude Code model aliases (sonnet/opus/haiku) to the Bedrock model id configured for the runtime."""
    return os.environ.get(f"ANTHROPIC_DEFAULT_{alias.upper()}_MODEL", alias)


def _subagent_type(tool_parameters: Any) -> str | None:
    if isinstance(tool_parameters, str):
        try:
            tool_parameters = json.loads(tool_parameters)
        except ValueError:
            return None
    if isinstance(tool_parameters, dict):
        value = tool_parameters.get("subagent_type")
        return str(value) if value else None
    return None


class AgentSpanProcessor(SpanProcessor):
    """Rename/annotate instrumentor spans so each agent (stage lead and subagents) is identifiable."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._agent_tool_spans: dict[int, str] = {}  # `Agent` TOOL span id -> subagent type
        self._agent_spans: dict[int, str] = {}  # AGENT span id -> agent name

    def on_start(self, span, parent_context=None) -> None:  # noqa: ANN001
        try:
            self._annotate(span)
        except Exception:  # noqa: BLE001
            log.debug("span annotation failed", exc_info=True)

    def _annotate(self, span) -> None:  # noqa: ANN001
        st = CURRENT.get()
        attrs = dict(span.attributes or {})
        kind = attrs.get("openinference.span.kind")
        parent_id = span.parent.span_id if span.parent is not None else None
        if st is not None:
            span.set_attributes({"meeting.id": st.meeting_id, "user.id": st.user_id, "stage": st.stage, "stage.attempt": st.attempt})

        if span.name == "ClaudeAgentSDK.query" and st is not None:
            span.update_name(f"invoke_agent {st.agent_name}")
            span.set_attributes(_agent_attributes(st.agent_name, st.stage, resolve_model(st.model)))
            with self._lock:
                self._agent_spans[span.context.span_id] = st.agent_name
            return

        if kind == "TOOL" and span.name == "Agent":
            sub = _subagent_type(attrs.get("tool.parameters"))
            if sub:
                span.update_name(f"Agent {sub}")
                span.set_attribute("subagent.type", sub)
                with self._lock:
                    self._agent_tool_spans[span.context.span_id] = sub

        if kind == "AGENT" and span.name.startswith("ClaudeAgentSDK.") and parent_id is not None:
            with self._lock:
                sub = self._agent_tool_spans.get(parent_id)
            if sub:
                model = resolve_model((st.subagent_models if st else {}).get(sub, "sonnet"))
                span.update_name(f"invoke_agent {sub}")
                span.set_attributes(_agent_attributes(sub, sub, model))
                with self._lock:
                    self._agent_spans[span.context.span_id] = sub
                return

        if "gen_ai.agent.name" not in attrs and parent_id is not None:
            with self._lock:
                owner = self._agent_spans.get(parent_id)
            if owner is None and st is not None and kind in ("TOOL", "LLM"):
                owner = st.agent_name
            if owner:
                span.set_attribute("gen_ai.agent.name", owner)

    def on_end(self, span) -> None:  # noqa: ANN001
        with self._lock:
            self._agent_tool_spans.pop(span.context.span_id, None)
            self._agent_spans.pop(span.context.span_id, None)

    def shutdown(self) -> None:
        return None

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return True


def _agent_attributes(name: str, agent_id: str, model: str) -> dict[str, Any]:
    return {
        "gen_ai.operation.name": "invoke_agent",
        "gen_ai.system": "aws.bedrock",
        "gen_ai.agent.name": name,
        "gen_ai.agent.id": agent_id,
        "agent.name": name,
        "gen_ai.request.model": model,
        "llm.model_name": model,
    }


def install() -> bool:
    """Attach the processor to the already-configured global TracerProvider (set up by opentelemetry-instrument)."""
    provider = trace.get_tracer_provider()
    add = getattr(provider, "add_span_processor", None)
    if add is None:
        log.info("no SDK tracer provider configured; per-agent span annotation disabled")
        return False
    add(AgentSpanProcessor())
    return True


def record_llm_turn(message: Any, *, start_ns: int, end_ns: int, agent_name: str) -> None:
    """Emit a `chat <model>` LLM span for one assistant turn, using the per-message usage the CLI reports."""
    usage = getattr(message, "usage", None) or {}
    model = str(getattr(message, "model", None) or "unknown")
    inp = int(usage.get("input_tokens") or 0)
    cache_read, cache_write = int(usage.get("cache_read_input_tokens") or 0), int(usage.get("cache_creation_input_tokens") or 0)
    prompt = inp + cache_read + cache_write
    # Output tokens are not recorded here: the streamed assistant message reports a partial count. Totals per agent
    # (input, output, cost) are on the enclosing invoke_agent span, set by the instrumentor from the final result.
    attrs: dict[str, Any] = {
        "openinference.span.kind": "LLM",
        "gen_ai.operation.name": "chat",
        "gen_ai.system": "aws.bedrock",
        "gen_ai.agent.name": agent_name,
        "gen_ai.request.model": model,
        "gen_ai.response.model": model,
        "llm.model_name": model,
        "gen_ai.usage.input_tokens": prompt,
        "llm.token_count.prompt": prompt,
        "llm.token_count.prompt_details.cache_read": cache_read,
        "llm.token_count.prompt_details.cache_write": cache_write,
    }
    if getattr(message, "stop_reason", None):
        attrs["llm.stop_reason"] = str(message.stop_reason)
    if getattr(message, "message_id", None):
        attrs["gen_ai.response.id"] = str(message.message_id)
    span = trace.get_tracer("meeting_agents").start_span(f"chat {model}", start_time=start_ns, attributes=attrs)
    span.end(end_time=end_ns)
