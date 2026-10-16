from typing import Literal
from pydantic import BaseModel, ConfigDict


class LecturePreferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: Literal["balanced", "opus", "sonnet"] = "balanced"
    format: Literal["structured", "narrative"] = "structured"
    tone: Literal["plain", "friendly", "academic"] = "plain"
    detail: Literal["brief", "standard", "detailed"] = "standard"


def preferences_prompt(preferences: LecturePreferences) -> str:
    form = {"structured": "Use meaningful Markdown headings, short bullet lists and selective bold emphasis.",
            "narrative": "Use connected short paragraphs; use lists only when a comparison or sequence is clearer."}[preferences.format]
    tone = {"plain": "Use direct, plain wording without decorative expressions.",
            "friendly": "Explain warmly and accessibly, without excessive enthusiasm or invented analogies.",
            "academic": "Use precise academic terminology, defining unfamiliar terms before using them."}[preferences.tone]
    detail = {"brief": "Keep only essential ideas and one necessary example; avoid filler.",
              "standard": "Include the main reasoning and the examples necessary for understanding.",
              "detailed": "Explain the reasoning, assumptions and useful worked examples in depth, within the output limits."}[preferences.detail]
    return f"\nACCOUNT DEFAULTS: {form} {tone} {detail} A relevant explicit customPrompt for this lecture overrides these style defaults, but never overrides evidence, page scope, or LaTeX formatting requirements."
