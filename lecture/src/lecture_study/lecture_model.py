"""Opus leads lecture reasoning; Sonnet handles bounded extraction and selection."""
import hashlib
import json
import os

from .deck_scope import DeckScope
from .model import Model, SYSTEM
from .schemas import Overview, Papers, SlideReading, Study, VideoMatch, VideoObservation
from .text import normalize_generated_text, validate_math_format
from .preferences import LecturePreferences, preferences_prompt
from .study_length import repair_study_length
from .text_integrity import DRAFT_MARKER, INTEGRITY_RULES, mark_unreadable, source_text_view, validate_text_integrity
from .unicode_repair import repair_generated_unicode

ROUTING_VERSION = "opus-led-v2-markdown"
FAST_SCHEMAS = frozenset({DeckScope, SlideReading, VideoObservation, VideoMatch, Papers})
FORMATTING = r"""
Write readable teaching prose in short paragraphs, normally 2–4 sentences each.
Separate paragraphs with real newline characters, not literal backslash-n text.
Return normal Unicode text, not JSON-encoded strings inside the deliver object.
Use $...$ for inline LaTeX and $$...$$ for display equations; never leave bare
LaTeX commands in prose. Preserve backslashes in mathematical commands.
This also applies to standalone variables and intuitive explanations: write
$\eta$, $\eta_{\mathrm{opt}}$, $v^t$, $t/T$, and $1-\alpha^t$, never η_opt or v^t
as ordinary prose. Use Markdown headings, lists, and bold only where useful.
An intuition-first request changes explanation depth, not mathematical formatting.
Avoid decorative middle dots and em dashes in prose; use words, commas or sentences.
Do not infer that unselected slides were not taught: selection limits this review,
not what occurred in the recording. State missing or uncertain evidence precisely.
"""


class LectureModel(Model):
    def __init__(self, check=lambda: None, client=None, *, model_id=None, fast_model_id=None, max_calls=None, preferences=None):
        super().__init__(check, client, system=SYSTEM + FORMATTING + INTEGRITY_RULES, model_id=model_id, max_calls=max_calls)
        self.fast_model_id = fast_model_id or os.environ.get("LECTURE_FAST_MODEL", "global.anthropic.claude-sonnet-5")
        self.preferences = LecturePreferences.model_validate(preferences or {})
        if self.preferences.model == "opus":
            self.fast_model_id = self.model_id
        elif self.preferences.model == "sonnet":
            self.model_id = self.fast_model_id
        policy = [ROUTING_VERSION, self.model_id, self.fast_model_id, self.preferences.model_dump()]
        self.cache_namespace = "models-" + hashlib.sha256(json.dumps(policy).encode()).hexdigest()[:20]

    def model_for(self, schema):
        return self.fast_model_id if schema in FAST_SCHEMAS else self.model_id

    def generate(self, schema, task, data, *args, **kwargs):
        if schema in (Study, Overview):
            task += preferences_prompt(self.preferences)
        return super().generate(schema, task, source_text_view(data), *args, **kwargs)

    def prepare_output(self, value):
        validate_text_integrity(value)
        normalized = normalize_generated_text(value)
        validate_math_format(normalized)
        return normalized

    def prepare_for_schema(self, schema, value):
        normalized = self.prepare_output(value)
        # Length repair uses the same Opus/Sonnet choice, liveness checks and call
        # budget. Revalidate the complete Study and its references in Model.generate.
        return repair_study_length(self, normalized) if schema is Study else normalized

    def repair_generated_output(self, schema, value, *, source, pictures):
        repaired = repair_generated_unicode(self, schema, value, source, pictures)
        return self.prepare_for_schema(schema, repaired)

    def retry_draft(self, value):
        try:
            return mark_unreadable(value, DRAFT_MARKER)
        except ValueError:
            return {"repairRequired": "The draft contained unreadable structured keys. Regenerate the schema from the original input evidence."}


class AnalysisCache:
    """Namespace model-derived caches while keeping transcripts/media/publication intact."""
    def __init__(self, store, namespace):
        self.store, self.namespace = store, namespace

    def __getattr__(self, name):
        return getattr(self.store, name)

    def cached(self, suffix, build, **kwargs):
        return self.store.cached(f"{self.namespace}/{suffix}", build, **kwargs)
