from meeting_agents import quality


def test_placeholder_summary_is_rejected():
    data = {"headline": "placeholder", "overview": "placeholder", "keyDecisions": [], "keyDiscussions": [], "risksAndIssues": [], "nextSteps": [], "markdown": "too-long-placeholder"}
    issues = quality.problems("summary", data)
    assert any("placeholder text" in i for i in issues)
    assert "overview shorter than 200 characters" in issues and "no key discussions" in issues


def test_real_summary_passes():
    data = {"headline": "9/15 결제 모듈 배포를 위해 PG 타임아웃을 5초로 늘리기로 결정", "overview": "회" * 250, "keyDecisions": ["a"], "keyDiscussions": [{"title": "t", "detail": "d"}], "risksAndIssues": [], "nextSteps": [], "markdown": "#" * 400}
    assert quality.problems("summary", data) == []


def test_stage_without_minimums_only_checks_placeholders():
    assert quality.problems("follow_ups", {"items": []}) == []
    assert quality.problems("follow_ups", {"items": [{"id": "F1", "title": "TBD", "priority": "low"}]})


def test_placeholder_word_inside_real_text_is_allowed():
    data = {"items": [{"id": "G1", "target": {"kind": "agenda", "title": "로딩 UX"}, "suggestion": "로딩 화면에 placeholder 스켈레톤을 보여 대기 시간을 체감상 줄이는 방안을 검토함"}]}
    assert quality.problems("suggestions", data) == []
    assert quality.problems("suggestions", {"items": [{"id": "G1", "target": {"kind": "agenda", "title": "x"}, "suggestion": "too-long-placeholder"}]})
