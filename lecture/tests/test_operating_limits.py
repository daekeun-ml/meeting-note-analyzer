import httpx
import pytest
from botocore.exceptions import ClientError
from lecture_study.model import Model
from lecture_study.schemas import Alignment
from lecture_study.search import GatewaySearch, gateway_check


def tool_list():
    return {"tools": [{"name": "academic-search___WebSearch", "inputSchema": {"properties": {"query": {"type": "string"}}}}]}


def test_missing_connector_is_checked_once_not_once_per_page():
    search = GatewaySearch("https://example.org/mcp", session=object())
    calls = []
    search.rpc = lambda method, args: calls.append(method) or {"tools": []}
    for _ in range(60):
        with pytest.raises(RuntimeError): search.search("paper")
    assert calls == ["tools/list"] and search.calls == 0


def test_server_fixed_result_limit_and_query_cache():
    search = GatewaySearch("https://example.org/mcp", session=object())
    calls = []
    def rpc(method, args):
        calls.append((method, args))
        return tool_list() if method == "tools/list" else {"structuredContent": {"results": []}}
    search.rpc = rpc
    assert gateway_check(search=search)["searchExecuted"] is False
    search.search("paper"); search.search("paper")
    assert calls[1][1]["arguments"] == {"query": "paper"}
    assert search.calls == 1 and len(calls) == 2


def test_permission_failure_stops_remaining_remote_searches():
    search = GatewaySearch("https://example.org/mcp", session=object())
    calls = []
    def rpc(method, args):
        calls.append(method)
        if method == "tools/list": return tool_list()
        response = httpx.Response(403, request=httpx.Request("POST", "https://example.org/mcp"))
        raise httpx.HTTPStatusError("denied", request=response.request, response=response)
    search.rpc = rpc
    for _ in range(10):
        with pytest.raises(RuntimeError): search.search("paper")
    assert calls == ["tools/list", "tools/call"] and search.calls == 1


def test_search_budget_stops_before_the_extra_request(monkeypatch):
    monkeypatch.setenv("LECTURE_MAX_SEARCH_CALLS", "1")
    search = GatewaySearch("https://example.org/mcp", session=object())
    search.rpc = lambda method, args: tool_list() if method == "tools/list" else {"structuredContent": {"results": []}}
    search.search("one")
    with pytest.raises(RuntimeError, match="limit"): search.search("two")
    assert search.calls == 1


def test_model_budget_counts_retries_and_reported_tokens(monkeypatch):
    monkeypatch.setenv("LECTURE_MAX_MODEL_CALLS", "2")
    monkeypatch.setattr("lecture_study.model.time.sleep", lambda _: None)
    class Client:
        calls = 0
        def converse(self, **kwargs):
            self.calls += 1
            if self.calls == 1: raise ClientError({"Error": {"Code": "ThrottlingException", "Message": "retry"}}, "Converse")
            return {"stopReason": "tool_use", "usage": {"inputTokens": 100, "outputTokens": 10}, "output": {"message": {"content": [{"toolUse": {"name": "deliver", "input": {"assignments": []}}}]}}}
    client = Client(); model = Model(client=client)
    model.generate(Alignment, "align", {})
    assert model.metrics() == {"modelCalls": 2, "modelCallLimit": 2, "inputTokens": 100, "outputTokens": 10}
    with pytest.raises(RuntimeError, match="limit"): model.generate(Alignment, "align", {})
    assert client.calls == 2
