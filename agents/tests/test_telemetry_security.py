from opentelemetry import propagate, trace
from opentelemetry.trace import TraceState
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

from meeting_agents.telemetry_security import BoundedPropagation, install

PARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"


def test_drops_large_tracestate_before_parser(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("oversized tracestate reached vulnerable parser")

    monkeypatch.setattr(TraceState, "from_header", forbidden)
    propagator = BoundedPropagation(TraceContextTextMapPropagator())
    for state in ["a=b" + "\t" * 100_000, ["a=b"] * 33, ["a=b" * 100] * 2]:
        context = propagator.extract({"traceparent": PARENT, "tracestate": state})
        assert trace.get_current_span(context).get_span_context().is_valid


def test_preserves_valid_tracecontext_and_injection():
    propagator = BoundedPropagation(TraceContextTextMapPropagator())
    context = propagator.extract({"traceparent": PARENT, "tracestate": "vendor=value"})
    assert trace.get_current_span(context).get_span_context().trace_state["vendor"] == "value"
    output = {}
    propagator.inject(output, context)
    assert output == {"traceparent": PARENT, "tracestate": "vendor=value"}


def test_install_is_idempotent_and_preserves_configured_propagation():
    original = propagate.get_global_textmap()
    try:
        delegate = TraceContextTextMapPropagator()
        propagate.set_global_textmap(delegate)
        install()
        guarded = propagate.get_global_textmap()
        install()
        assert propagate.get_global_textmap() is guarded
        assert guarded.delegate is delegate
        assert guarded.fields == delegate.fields
    finally:
        propagate.set_global_textmap(original)
