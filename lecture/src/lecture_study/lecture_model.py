"""Opus leads lecture reasoning; Sonnet handles bounded extraction and selection."""
import hashlib
import json
import os

from .deck_scope import DeckScope
from .model import Model, SYSTEM
from .schemas import Papers, SlideReading, VideoMatch, VideoObservation
from .text import normalize_generated_text

ROUTING_VERSION = "opus-led-v1"
FAST_SCHEMAS = frozenset({DeckScope, SlideReading, VideoObservation, VideoMatch, Papers})
FORMATTING = r"""
Write readable teaching prose in short paragraphs, normally 2–4 sentences each.
Separate paragraphs with real newline characters, not literal backslash-n text.
Return normal Unicode text, not JSON-encoded strings inside the deliver object.
Use $...$ for inline LaTeX and $$...$$ for display equations; never leave bare
LaTeX commands in prose. Preserve backslashes in mathematical commands.
Do not infer that unselected slides were not taught: selection limits this review,
not what occurred in the recording. State missing or uncertain evidence precisely.
"""


class LectureModel(Model):
    def __init__(self, check=lambda: None, client=None, *, model_id=None, fast_model_id=None, max_calls=None):
        super().__init__(check, client, system=SYSTEM + FORMATTING, model_id=model_id, max_calls=max_calls)
        self.fast_model_id = fast_model_id or os.environ.get("LECTURE_FAST_MODEL", "global.anthropic.claude-sonnet-5")
        policy = [ROUTING_VERSION, self.model_id, self.fast_model_id]
        self.cache_namespace = "models-" + hashlib.sha256(json.dumps(policy).encode()).hexdigest()[:20]

    def model_for(self, schema):
        return self.fast_model_id if schema in FAST_SCHEMAS else self.model_id

    def prepare_output(self, value):
        # Replacement characters indicate damaged generated text, not an invitation
        # to invent missing source words. Ask for a clean, source-grounded draft.
        if "\ufffd" in json.dumps(value, ensure_ascii=False):
            raise ValueError("Generated text contains a replacement character. Rephrase using readable source evidence; do not guess illegible source text.")
        return normalize_generated_text(value)


class AnalysisCache:
    """Namespace model-derived caches while keeping transcripts/media/publication intact."""
    def __init__(self, store, namespace):
        self.store, self.namespace = store, namespace

    def __getattr__(self, name):
        return getattr(self.store, name)

    def cached(self, suffix, build, **kwargs):
        return self.store.cached(f"{self.namespace}/{suffix}", build, **kwargs)
