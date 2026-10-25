"""Bound untrusted W3C tracestate before the AWS-pinned OpenTelemetry parser.

Remove this compatibility guard after AWS distro permits opentelemetry-api
>=1.45.1 (GHSA-xcq7-p3pf-p88h). Keep all other propagation, including X-Ray,
delegated to the configured propagator.
"""
from opentelemetry import propagate
from opentelemetry.propagators.textmap import Getter, TextMapPropagator, default_getter, default_setter

MAX_TRACESTATE_CHARS = 512
MAX_TRACESTATE_HEADERS = 32


class _BoundedGetter(Getter):
    def __init__(self, delegate):
        self.delegate = delegate

    def keys(self, carrier):
        return self.delegate.keys(carrier)

    def get(self, carrier, key):
        values = self.delegate.get(carrier, key)
        if key.lower() == "tracestate" and values:
            if len(values) > MAX_TRACESTATE_HEADERS:
                return None
            total = len(values) - 1
            for value in values:
                total += len(value)
                if total > MAX_TRACESTATE_CHARS:
                    return None
        return values


class BoundedPropagation(TextMapPropagator):
    def __init__(self, delegate):
        self.delegate = delegate

    @property
    def fields(self):
        return self.delegate.fields

    def extract(self, carrier, context=None, getter=default_getter):
        return self.delegate.extract(carrier, context=context, getter=_BoundedGetter(getter))

    def inject(self, carrier, context=None, setter=default_setter):
        return self.delegate.inject(carrier, context=context, setter=setter)


def install():
    current = propagate.get_global_textmap()
    if not isinstance(current, BoundedPropagation):
        propagate.set_global_textmap(BoundedPropagation(current))
