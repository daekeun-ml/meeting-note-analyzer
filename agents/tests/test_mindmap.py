from meeting_agents import mindmap, sanitize

PRIOR = {
    "agenda": {"items": [{"id": "A1", "decisions": ["타임아웃 5초"]}, {"id": "A2", "decisions": []}]},
    "follow_ups": {"items": [{"id": "F1"}, {"id": "F2"}]},
}


def _nodes():
    return [
        {"id": "n1", "parentId": None, "label": "주간회의", "kind": "root"},
        {"id": "n2", "parentId": "n1", "label": "결제 모듈 배포", "kind": "agenda", "ref": "A1"},
        {"id": "n3", "parentId": "n2", "label": "타임아웃 5초, 리트라이 1회", "kind": "decision"},
        {"id": "n4", "parentId": "n2", "label": "부하 테스트 (이서현, 목요일)", "kind": "followup", "ref": "F1"},
        {"id": "n5", "parentId": "n1", "label": "고객사 A 피드백", "kind": "agenda", "ref": "A2"},
        {"id": "n6", "parentId": "n5", "label": "엑셀 엑스포트 착수", "kind": "followup", "ref": "F2"},
        {"id": "n7", "parentId": "n5", "label": "차트 잘림 수정", "kind": "question"},
        {"id": "n8", "parentId": "n1", "label": "리스크", "kind": "risk"},
    ]


def test_check_passes_complete_map():
    problems, coverage = mindmap.check({"nodes": _nodes()}, PRIOR)
    assert problems == []
    assert coverage == {"agenda": 1.0, "followUps": 1.0, "decisions": 1.0}


def test_check_reports_missing_agenda_and_bad_parent():
    nodes = [n for n in _nodes() if n["id"] != "n5"]
    nodes[-1]["parentId"] = "ghost"
    problems, coverage = mindmap.check({"nodes": nodes}, PRIOR)
    assert any("A2" in p for p in problems) and any("ghost" in p for p in problems)
    assert coverage["agenda"] == 0.5


def test_check_rejects_two_roots_and_depth():
    nodes = _nodes() + [{"id": "n9", "parentId": None, "label": "x", "kind": "root"}]
    problems, _ = mindmap.check({"nodes": nodes}, PRIOR)
    assert any("one root" in p for p in problems)


def test_mermaid_and_outline_render_hierarchy_without_shape_chars():
    mm = mindmap.to_mermaid(_nodes())
    assert mm.startswith("mindmap\n  root((주간회의))\n    n2(결제 모듈 배포)\n      n3(")
    assert "(이서현, 목요일)" not in mm and "n4(부하 테스트 이서현, 목요일)" in mm
    outline = mindmap.to_outline(_nodes())
    assert outline.splitlines()[:3] == ["- 주간회의", "  - 결제 모듈 배포", "    - 타임아웃 5초, 리트라이 1회"]


def test_sanitize_removes_symbols_and_emoji():
    assert sanitize.clean_text("PM·회의 진행자 ✅ 완료 — 다음 단계 → 배포 👍") == "PM, 회의 진행자 완료 - 다음 단계 -> 배포"
    out = sanitize.clean_output({"a": ["리스크·이슈"], "b": {"c": "2–3주"}, "n": 3})
    assert out == {"a": ["리스크, 이슈"], "b": {"c": "2-3주"}, "n": 3}
