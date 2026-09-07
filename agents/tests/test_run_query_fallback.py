import asyncio
from dataclasses import dataclass

import meeting_agents.runner as runner


@dataclass
class ToolUseBlock:
    id: str
    name: str
    input: dict


@dataclass
class AssistantMessage:
    content: list
    model: str = "claude-sonnet-5"
    parent_tool_use_id: str | None = None
    usage: dict | None = None
    stop_reason: str | None = None
    message_id: str | None = None


@dataclass
class ResultMessage:
    subtype: str
    structured_output: dict | None


def test_falls_back_to_last_valid_tool_input(monkeypatch):
    valid = {"markdown": "# notes", "sections": [{"title": "안건 1", "bullets": ["결정"]}]}

    async def fake_query(prompt, options):
        yield AssistantMessage([ToolUseBlock("t1", "Read", {"file_path": "x"})])
        yield AssistantMessage([ToolUseBlock("t2", "StructuredOutput", valid)], usage={"input_tokens": 1, "output_tokens": 2})
        yield ResultMessage("success", None)

    import claude_agent_sdk

    monkeypatch.setattr(runner, "query", fake_query)
    monkeypatch.setattr(runner, "ResultMessage", ResultMessage)
    monkeypatch.setattr(claude_agent_sdk, "AssistantMessage", AssistantMessage, raising=False)
    monkeypatch.setattr(claude_agent_sdk, "ToolUseBlock", ToolUseBlock, raising=False)
    data, result = asyncio.run(runner.run_query("p", None, "notes"))
    assert data == valid and result.subtype == "success"


def test_prefers_structured_output_when_present(monkeypatch):
    async def fake_query(prompt, options):
        yield ResultMessage("success", {"markdown": "m", "sections": []})

    monkeypatch.setattr(runner, "query", fake_query)
    monkeypatch.setattr(runner, "ResultMessage", ResultMessage)
    data, _ = asyncio.run(runner.run_query("p", None, "notes"))
    assert data == {"markdown": "m", "sections": []}
