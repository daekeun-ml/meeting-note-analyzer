"""Pydantic output contracts per stage (mirror of packages/shared/src/stages.ts)."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---- transcript_analysis ----
class LanguageShare(Strict):
    code: str
    share: float = Field(ge=0, le=1)


class QualityIssue(Strict):
    type: str
    description: str
    segmentIds: list[str] = Field(default_factory=list)


class Quality(Strict):
    overall: Literal["good", "fair", "poor"]
    issues: list[QualityIssue] = Field(default_factory=list)


class GlossaryEntry(Strict):
    term: str
    normalized: str | None = None
    kind: Literal["person", "org", "product", "project", "acronym", "other"]
    notes: str | None = None


class Normalization(Strict):
    segmentId: str
    original: str
    corrected: str
    reason: str


class TranscriptAnalysis(Strict):
    languages: list[LanguageShare]
    primaryLanguage: str
    quality: Quality
    glossary: list[GlossaryEntry] = Field(default_factory=list)
    normalizations: list[Normalization] = Field(default_factory=list)
    notes: str = ""


# ---- topic_segmentation ----
class Topic(Strict):
    id: str
    title: str
    startSec: float
    endSec: float
    segmentIds: list[str] = Field(default_factory=list)
    summary: str
    keywords: list[str] = Field(default_factory=list)


class TopicSegmentation(Strict):
    meetingType: str
    purpose: str
    overview: str
    topics: list[Topic]


# ---- speaker_attribution ----
class SpeakerEvidence(Strict):
    segmentId: str
    quote: str = Field(min_length=1)


class AttributionDecision(Strict):
    # Older stage outputs are proposals until their evidence can be checked.
    decision: Literal["confirmed", "review_required"] = "review_required"
    basis: Literal["explicit_identity", "context"] = "context"
    support: list[SpeakerEvidence] = Field(default_factory=list)


class SpeakerInfo(AttributionDecision):
    id: str
    label: str
    name: str | None = None
    role: str | None = None
    confidence: float = Field(ge=0, le=1)
    evidence: list[str] = Field(default_factory=list)


class Merge(AttributionDecision):
    from_: list[str] = Field(alias="from")
    to: str
    confidence: float = Field(default=0, ge=0, le=1)
    reason: str = ""
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Relabel(AttributionDecision):
    segmentId: str
    from_: str = Field(alias="from")
    to: str
    reason: str | None = None
    confidence: float = Field(default=0, ge=0, le=1)
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class SpeakerAttribution(Strict):
    speakers: list[SpeakerInfo]
    merges: list[Merge] = Field(default_factory=list)
    relabels: list[Relabel] = Field(default_factory=list)
    notes: str = ""


# ---- agenda ----
class AgendaItem(Strict):
    id: str
    title: str
    background: str
    discussionPoints: list[str] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    openQuestions: list[str] = Field(default_factory=list)
    participants: list[str] = Field(default_factory=list)
    startSec: float
    endSec: float
    topicIds: list[str] = Field(default_factory=list)


class Agenda(Strict):
    items: list[AgendaItem]


# ---- summary ----
class KeyDiscussion(Strict):
    title: str
    detail: str


class Summary(Strict):
    headline: str
    overview: str
    keyDecisions: list[str] = Field(default_factory=list)
    keyDiscussions: list[KeyDiscussion] = Field(default_factory=list)
    risksAndIssues: list[str] = Field(default_factory=list)
    nextSteps: list[str] = Field(default_factory=list)
    markdown: str


# ---- notes ----
class NoteSection(Strict):
    agendaId: str | None = None
    title: str
    bullets: list[str] = Field(default_factory=list)


class Notes(Strict):
    markdown: str
    sections: list[NoteSection] = Field(default_factory=list)


# ---- meeting_brief (the runtime resolves referenced text and transcript evidence) ----
class BriefDecision(Strict):
    agendaId: str = Field(min_length=1)
    decisionIndex: int = Field(ge=0)
    process: str = Field(max_length=360)
    rationaleStatus: Literal["supported", "not_recorded"]
    evidenceSegmentIds: list[str] = Field(max_length=6)


class BriefQuestion(Strict):
    agendaId: str = Field(min_length=1)
    questionIndex: int = Field(ge=0)


class MeetingBrief(Strict):
    headline: str = Field(min_length=1, max_length=180)
    decisions: list[BriefDecision] = Field(max_length=3)
    followUpIds: list[str] = Field(max_length=3)
    openQuestions: list[BriefQuestion] = Field(max_length=3)


# ---- follow_ups ----
class FollowUpItem(Strict):
    id: str
    title: str
    ownerSpeakerId: str | None = None
    ownerName: str | None = None
    dueHint: str | None = None
    priority: Literal["high", "medium", "low"]
    evidenceSegmentIds: list[str] = Field(default_factory=list)
    status: Literal["new", "carried_over"] = "new"
    carriedFrom: str | None = None


class FollowUps(Strict):
    items: list[FollowUpItem]


# ---- suggestions ----
class SuggestionTarget(Strict):
    kind: Literal["agenda", "question", "problem"]
    refId: str | None = None
    title: str


class SuggestionItem(Strict):
    id: str
    target: SuggestionTarget
    suggestion: str
    alternatives: list[str] = Field(default_factory=list)
    nextSteps: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    clarifyingQuestions: list[str] = Field(default_factory=list)
    conflictsWithPast: str | None = None


class Suggestions(Strict):
    items: list[SuggestionItem]


# ---- mindmap ----
class MindMapNode(Strict):
    id: str
    parentId: str | None = None
    label: str = Field(min_length=1, max_length=80)
    kind: Literal["root", "agenda", "topic", "decision", "question", "followup", "risk", "suggestion", "note"]
    ref: str | None = None


class MindMapReview(Strict):
    verdict: Literal["pass", "revised"]
    findings: list[str] = Field(default_factory=list)


class MindMap(Strict):
    nodes: list[MindMapNode] = Field(min_length=1)
    review: MindMapReview


SCHEMAS: dict[str, type[BaseModel]] = {
    "transcript_analysis": TranscriptAnalysis,
    "topic_segmentation": TopicSegmentation,
    "speaker_attribution": SpeakerAttribution,
    "agenda": Agenda,
    "summary": Summary,
    "notes": Notes,
    "follow_ups": FollowUps,
    "suggestions": Suggestions,
    "mindmap": MindMap,
    "meeting_brief": MeetingBrief,
}


def json_schema(stage: str) -> dict:
    """JSON schema (draft-07 compatible) for Claude's structured output."""
    schema = SCHEMAS[stage].model_json_schema(by_alias=True)
    schema["$schema"] = "http://json-schema.org/draft-07/schema#"
    return schema


def validate(stage: str, data: dict) -> dict:
    model = SCHEMAS[stage].model_validate(data)
    return model.model_dump(by_alias=True, exclude_none=True)
