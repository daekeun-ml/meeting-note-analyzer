from pathlib import Path

from meeting_agents.payload import StagePayload
from meeting_agents.runner import build_task_prompt, stage_note, subagent_prompt, system_prompt
from meeting_agents.stages import SPECS
from meeting_agents.transcript import Transcript


def test_payload_validation():
    p = StagePayload(stage="summary", meetingId="abc-123", ownerSub="u", transcriptKey="transcripts/abc-123/transcript.json")
    assert p.outputLanguage == "ko" and p.taskToken is None
    import pytest

    with pytest.raises(Exception):
        StagePayload(stage="summary", meetingId="../x", ownerSub="u", transcriptKey="k")
    assert StagePayload(stage="mindmap", meetingId="m", ownerSub="u", transcriptKey="k").stage == "mindmap"
    with pytest.raises(Exception):
        StagePayload(stage="bogus", meetingId="m", ownerSub="u", transcriptKey="k")


def test_task_prompt_mentions_language_files_and_subagents(tmp_path: Path):
    t = Transcript({"durationSec": 600, "language": "ko", "speakers": [{"id": "S1"}], "segments": []})
    p = StagePayload(stage="topic_segmentation", meetingId="m", ownerSub="u", title="주간 회의", outputLanguage="ko", transcriptKey="k")
    prompt = build_task_prompt(p, SPECS["topic_segmentation"], tmp_path, t, retry_note="fix it")
    assert "Korean" in prompt and "chunks/chunk-NN.md" in prompt and "prior/transcript_analysis.json" in prompt
    assert "`chunk-analyst`" in prompt and "fix it" in prompt


def test_stage_note_compact():
    note = stage_note("agenda", {"items": [{"id": "A1", "title": "예산"}]})
    assert note == "Agenda: A1 예산"


def test_system_prompts_include_common_rules_and_style_guide():
    sp = system_prompt(SPECS["summary"])
    assert "automated meeting-analysis pipeline" in sp and "middle dot" in sp and "executive summarizer" in sp
    sub = subagent_prompt(SPECS["mindmap"].subagents[0])
    assert "VERDICT" in sub and "middle dot" in sub


def test_prompts_contain_no_banned_punctuation():
    from meeting_agents.config import PROMPTS_DIR

    for p in PROMPTS_DIR.glob("*.md"):
        text = p.read_text(encoding="utf-8")
        if p.name == "_style.md":
            continue
        assert "—" not in text and "–" not in text and "·" not in text, p.name
