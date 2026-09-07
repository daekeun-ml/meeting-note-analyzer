import meeting_agents.runner as runner


def test_bedrock_unexpected_error_is_transient():
    exc = Exception("Claude Code returned an error result: API Error: The system encountered an unexpected error during processing. Try your request again. (exit code: 1)")
    assert runner._looks_transient(exc)
    assert not runner._looks_transient(Exception("stage produced no valid structured output"))


def test_query_retries_transient_then_succeeds(monkeypatch):
    calls = {"n": 0}

    async def flaky(prompt, options, stage):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("API Error: The system encountered an unexpected error during processing. Try your request again.")
        return {"ok": True}, None

    monkeypatch.setattr(runner, "run_query", flaky)
    monkeypatch.setattr(runner, "API_RETRY_DELAYS_SEC", (0, 0))
    monkeypatch.setattr(runner.time, "sleep", lambda s: None)
    data, _ = runner._query_with_retry("p", None, "summary")
    assert data == {"ok": True} and calls["n"] == 2


def test_query_does_not_retry_permanent_errors(monkeypatch):
    async def broken(prompt, options, stage):
        raise RuntimeError("permission denied")

    monkeypatch.setattr(runner, "run_query", broken)
    monkeypatch.setattr(runner.time, "sleep", lambda s: None)
    try:
        runner._query_with_retry("p", None, "summary")
    except RuntimeError as exc:
        assert "permission denied" in str(exc)
    else:
        raise AssertionError("expected the permanent error to propagate")
