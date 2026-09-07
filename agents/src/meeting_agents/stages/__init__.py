"""Stage specifications: which model, effort, inputs, subagents and prompt each stage uses."""
from __future__ import annotations

from dataclasses import dataclass, field

from ..config import OPUS, SONNET


@dataclass(frozen=True)
class SubagentSpec:
    name: str
    description: str
    prompt_file: str
    model: str = "sonnet"
    max_turns: int = 20
    effort: str = "medium"


@dataclass(frozen=True)
class StageSpec:
    name: str
    model: str
    effort: str
    max_turns: int
    prompt_file: str
    inputs: tuple[str, ...] = ()
    subagents: tuple[SubagentSpec, ...] = field(default_factory=tuple)
    use_chunks: bool = False
    use_memory: bool = False


CHUNK_ANALYST = SubagentSpec(
    name="chunk-analyst",
    description="Analyzes ONE transcript chunk file in depth (terms, quality issues, speakers, key points). Use one per chunk, in parallel.",
    prompt_file="sub_chunk_analyst.md",
)
TOPIC_SPEAKER = SubagentSpec(
    name="topic-speaker-analyst",
    description="Examines ONE topic window of the transcript to infer who is speaking (names, roles, addressing patterns) and flags diarization errors. Use one per topic, in parallel.",
    prompt_file="sub_topic_speaker.md",
)
ISSUE_RESEARCHER = SubagentSpec(
    name="issue-researcher",
    description="Investigates ONE agenda item or open problem: gathers relevant transcript evidence and prior-meeting memory, and drafts options. Use one per issue, in parallel.",
    prompt_file="sub_issue_researcher.md",
    effort="high",
)

MINDMAP_REVIEWER = SubagentSpec(
    name="mindmap-reviewer",
    description="Verifies ONE draft mind map against the agenda, summary, follow-up and suggestion outputs: coverage, fidelity, structure. Returns findings and a pass/revise verdict.",
    prompt_file="sub_mindmap_reviewer.md",
    effort="high",
)

SPECS: dict[str, StageSpec] = {
    "transcript_analysis": StageSpec("transcript_analysis", SONNET, "medium", 40, "transcript_analysis.md", (), (CHUNK_ANALYST,), use_chunks=True, use_memory=True),
    "topic_segmentation": StageSpec("topic_segmentation", OPUS, "high", 40, "topic_segmentation.md", ("transcript_analysis",), (CHUNK_ANALYST,), use_chunks=True),
    "speaker_attribution": StageSpec("speaker_attribution", OPUS, "high", 50, "speaker_attribution.md", ("transcript_analysis", "topic_segmentation"), (TOPIC_SPEAKER,), use_chunks=True, use_memory=True),
    "agenda": StageSpec("agenda", OPUS, "high", 30, "agenda.md", ("transcript_analysis", "topic_segmentation", "speaker_attribution")),
    "summary": StageSpec("summary", OPUS, "high", 30, "summary.md", ("topic_segmentation", "speaker_attribution", "agenda")),
    "notes": StageSpec("notes", SONNET, "medium", 20, "notes.md", ("agenda", "summary", "speaker_attribution")),
    "follow_ups": StageSpec("follow_ups", SONNET, "high", 30, "follow_ups.md", ("agenda", "summary", "speaker_attribution"), use_memory=True),
    "suggestions": StageSpec("suggestions", OPUS, "xhigh", 50, "suggestions.md", ("topic_segmentation", "speaker_attribution", "agenda", "summary", "follow_ups"), (ISSUE_RESEARCHER,), use_memory=True),
    "mindmap": StageSpec("mindmap", SONNET, "high", 30, "mindmap.md", ("agenda", "summary", "follow_ups", "suggestions", "speaker_attribution"), (MINDMAP_REVIEWER,)),
    "meeting_brief": StageSpec("meeting_brief", SONNET, "medium", 12, "meeting_brief.md", ("agenda", "summary", "notes", "follow_ups", "speaker_attribution")),
}
