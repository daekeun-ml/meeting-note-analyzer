import pytest
from pydantic import ValidationError

from meeting_agents.schemas import SCHEMAS, json_schema, validate
from meeting_agents.stages import SPECS
from meeting_agents.config import STAGES, PROMPTS_DIR


def test_every_stage_has_schema_spec_and_prompt():
    for stage in STAGES:
        assert stage in SCHEMAS and stage in SPECS
        assert (PROMPTS_DIR / SPECS[stage].prompt_file).exists(), stage
        for sub in SPECS[stage].subagents:
            assert (PROMPTS_DIR / sub.prompt_file).exists(), sub.name


def test_json_schema_is_draft07_with_alias():
    s = json_schema("speaker_attribution")
    assert s["$schema"].startswith("http://json-schema.org/draft-07")
    assert "from" in s["$defs"]["Merge"]["properties"]


def test_validate_rejects_extra_keys_and_roundtrips_alias():
    out = validate("speaker_attribution", {"speakers": [{"id": "S1", "label": "A", "confidence": 0.5}], "merges": [{"from": ["S2"], "to": "S1"}], "relabels": []})
    assert out["merges"][0]["from"] == ["S2"]
    with pytest.raises(ValidationError):
        validate("summary", {"headline": "h", "overview": "o", "markdown": "m", "bogus": 1})


def test_follow_up_defaults():
    out = validate("follow_ups", {"items": [{"id": "F1", "title": "do", "priority": "high"}]})
    assert out["items"][0]["status"] == "new"
