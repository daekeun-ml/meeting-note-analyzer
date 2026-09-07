import json

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from meeting_agents import tracing

EXPORTER = InMemorySpanExporter()
PROVIDER = TracerProvider()
PROVIDER.add_span_processor(tracing.AgentSpanProcessor())
PROVIDER.add_span_processor(SimpleSpanProcessor(EXPORTER))
trace.set_tracer_provider(PROVIDER)


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    EXPORTER.clear()
    monkeypatch.setenv("ANTHROPIC_DEFAULT_SONNET_MODEL", "global.anthropic.claude-sonnet-5")
    monkeypatch.setenv("ANTHROPIC_DEFAULT_OPUS_MODEL", "global.anthropic.claude-opus-5")
    token = tracing.CURRENT.set(tracing.StageTrace("transcript_analysis", "m-1", "u-1", "sonnet", {"chunk-analyst": "sonnet"}))
    yield
    tracing.CURRENT.reset(token)


def _by_name():
    return {s.name: s for s in EXPORTER.get_finished_spans()}


def test_lead_subagent_and_tool_spans_are_named_per_agent():
    tracer = trace.get_tracer("test")
    with tracer.start_as_current_span("ClaudeAgentSDK.query", attributes={"openinference.span.kind": "AGENT"}):
        params = json.dumps({"subagent_type": "chunk-analyst", "prompt": "..."})
        with tracer.start_as_current_span("Agent", attributes={"openinference.span.kind": "TOOL", "tool.parameters": params}):
            with tracer.start_as_current_span("ClaudeAgentSDK.Agent", attributes={"openinference.span.kind": "AGENT", "agent.name": "Agent"}):
                with tracer.start_as_current_span("Read", attributes={"openinference.span.kind": "TOOL"}):
                    pass
        with tracer.start_as_current_span("Grep", attributes={"openinference.span.kind": "TOOL"}):
            pass
    spans = _by_name()
    lead = spans["invoke_agent transcript-analyst"]
    assert lead.attributes["gen_ai.agent.name"] == "transcript-analyst"
    assert lead.attributes["gen_ai.request.model"] == "global.anthropic.claude-sonnet-5"
    assert lead.attributes["meeting.id"] == "m-1" and lead.attributes["user.id"] == "u-1" and lead.attributes["stage"] == "transcript_analysis"
    sub = spans["invoke_agent chunk-analyst"]
    assert sub.attributes["gen_ai.agent.name"] == "chunk-analyst" and sub.attributes["gen_ai.request.model"] == "global.anthropic.claude-sonnet-5"
    assert spans["Agent chunk-analyst"].attributes["subagent.type"] == "chunk-analyst"
    assert spans["Read"].attributes["gen_ai.agent.name"] == "chunk-analyst"
    assert spans["Grep"].attributes["gen_ai.agent.name"] == "transcript-analyst"


def test_llm_turn_span_carries_usage():
    class Msg:
        model = "claude-sonnet-5"
        usage = {"input_tokens": 10, "output_tokens": 7, "cache_read_input_tokens": 100, "cache_creation_input_tokens": 5}
        stop_reason = "tool_use"
        message_id = "msg_1"

    tracing.record_llm_turn(Msg(), start_ns=1_000, end_ns=2_000, agent_name="advisor")
    span = _by_name()["chat claude-sonnet-5"]
    assert span.attributes["gen_ai.usage.input_tokens"] == 115 and "gen_ai.usage.output_tokens" not in span.attributes
    assert span.attributes["gen_ai.agent.name"] == "advisor"
    assert span.attributes["openinference.span.kind"] == "LLM" and span.end_time - span.start_time == 1_000


def test_spans_outside_a_stage_are_left_alone():
    tracing.CURRENT.set(None)
    with trace.get_tracer("test").start_as_current_span("ClaudeAgentSDK.query", attributes={"openinference.span.kind": "AGENT"}):
        pass
    assert "ClaudeAgentSDK.query" in _by_name()
