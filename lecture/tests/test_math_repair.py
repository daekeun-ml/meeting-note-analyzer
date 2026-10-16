import copy

import pytest

from lecture_study.lecture_model import LectureModel
from lecture_study.math_repair import repair_math_text, validate_formatting_only
from lecture_study.schemas import Study
from lecture_study.study import validate_references
from lecture_study.text import math_issues, normalize_text, validate_math_format


def study():
    return {"slideSummary": "문맥 임베딩을 설명합니다.", "spokenSummary": "", "explanation": r"기울기는 \nabla f(x)입니다.",
            "concepts": [{"term": "문맥", "explanation": "주변 단어의 정보입니다."}], "mathNotes": [],
            "relatedPages": [], "reviewQuestions": [], "flashcards": [], "searchQueries": []}


def response(value, stop="tool_use"):
    return {"stopReason": stop, "usage": {"inputTokens": 5, "outputTokens": 2},
            "output": {"message": {"content": [{"toolUse": {"name": "deliver", "input": value}}]}}}


def name(request):
    return request["toolConfig"]["tools"][0]["toolSpec"]["inputSchema"]["json"]["title"]


@pytest.mark.parametrize("text", [
    r"비용은 $20이며 학습률은 $\eta$입니다.",
    r"단어는 $\text{`bank`}$로 표시합니다.",
    "수식 $\\alpha +\n\\beta$입니다.",
    r"경로 C:\text\notes 및 https://example.org/data?$select=value 입니다.",
    "````python\ntext = '``` $x'\n\\nabla f(x)\n````\n\n결과는 $x$입니다.",
    "~~~python\nprint('$x')\n\\nabla f(x)\n~~~\n\n결과는 $x$입니다.",
    r"코드 ``print(`x`, '\nabla')``와 $\alpha$입니다.",
    r"참고 $\href{https://example.org}{x}$입니다.",
    r"계산은 $2 + 3$이고 값은 $5$입니다.",
    r"비용은 $20 또는 $30입니다. 수식은 $\alpha$입니다.",
    r"\[\begin{aligned}x&=\alpha\\y&=\beta\end{aligned}\]",
])
def test_valid_math_code_paths_and_currency_do_not_trigger_false_failures(text):
    normalized = normalize_text(text)
    validate_math_format(normalized)
    assert normalize_text(normalized) == normalized


def test_bare_formula_with_korean_text_is_not_split_mid_brace_by_normalization():
    text = r"확률은 \frac{\text{사건 수}}{\text{전체 수}}입니다."
    assert normalize_text(text) == text
    issues = math_issues({"explanation": text})
    assert issues[0]["path"] == ("explanation",) and issues[0]["line"] == 1
    with pytest.raises(ValueError, match="line 1, column"):
        validate_math_format({"explanation": text})


def test_only_invalid_field_is_repaired_without_extra_model_calls_or_content_changes():
    original = study()
    snapshot = copy.deepcopy(original)
    class Client:
        calls = []
        def converse(self, **kwargs):
            self.calls.append(kwargs)
            return response(original)
    model = LectureModel(client=Client(), max_calls=1)
    result = model.generate(Study, "Study", {}).model_dump()
    assert result == Study.model_validate({**original, "explanation": r"기울기는 $\nabla f(x)$입니다."}).model_dump()
    assert original == snapshot and model.calls == 1


@pytest.mark.parametrize("changed", [
    r"기울기는 $\nabla g(x)$입니다.",  # Changed function.
    r"기울기는 $-\nabla f(x)$입니다.",  # Changed sign.
    "기울기입니다.",  # Deleted the formula.
    r"기울기는 $\nabla f(x)$이 아닙니다.",  # Changed the claim.
])
def test_formatting_guard_rejects_changes_to_the_explanation_or_formula(changed):
    original = study()
    with pytest.raises(ValueError, match="changed content"):
        validate_formatting_only(original["explanation"], changed)


def test_nested_formula_field_repair_keeps_source_checks_and_references_unchanged():
    original = study()
    original["explanation"] = "식의 의미를 설명합니다."
    original["mathNotes"] = [{"kind": "formula", "name": "기울기", "statement": r"\nabla f(x)", "steps": [],
                              "intuition": "변화 방향", "supplementary": True,
                              "sourceCheck": {"status": "uncertain", "explanation": "음성만으로 확인한 보충 표기입니다.", "correctedStatement": ""}}]
    original["relatedPages"] = [{"page": 1, "topic": "배경"}]
    class Client:
        calls = 0
        def converse(self, **kwargs):
            self.calls += 1
            return response(original)
    result = LectureModel(client=Client(), max_calls=1).generate(Study, "Study", {},
        validate=lambda value: validate_references(value, {"pages": [{"page": 1}]}))
    assert result.mathNotes[0].statement == r"$\nabla f(x)$"
    assert result.mathNotes[0].sourceCheck.status == "uncertain"
    assert result.mathNotes[0].supplementary is True and result.relatedPages[0].page == 1


def test_formatting_only_guard_preserves_code_currency_and_word_boundaries():
    validate_formatting_only(r"비용 $20, 기울기 \nabla f(x)", r"비용 $20, 기울기 $\nabla f(x)$")
    with pytest.raises(ValueError):
        validate_formatting_only(r"비용 $20, 기울기 \nabla f(x)", r"비용 20, 기울기 $\nabla f(x)$")
    with pytest.raises(ValueError):
        validate_formatting_only(r"`$\alpha$`와 \beta", r"`$\gamma$`와 $\beta$")
    with pytest.raises(ValueError):
        validate_formatting_only(r"not able \alpha", r"notable $\alpha$")


def test_partial_output_is_not_repaired_and_repairs_respect_the_model_call_budget():
    class Client:
        def __init__(self, stop="tool_use"): self.stop, self.calls = stop, []
        def converse(self, **kwargs):
            self.calls.append(kwargs)
            return response(study(), self.stop)
    capped = Client()
    assert LectureModel(client=capped, max_calls=1).generate(Study, "Study", {}).explanation == r"기울기는 $\nabla f(x)$입니다."
    assert len(capped.calls) == 1
    partial = Client("max_tokens")
    with pytest.raises(ValueError, match="cut off"):
        LectureModel(client=partial, max_calls=3).generate(Study, "Study", {})
    assert all(name(request) == "Study" for request in partial.calls)


@pytest.mark.parametrize("before,after", [
    (r"확률은 \frac{\text{사건 수}}{\text{전체 수}}입니다.", r"확률은 $\frac{\text{사건 수}}{\text{전체 수}}$입니다."),
    (r"벡터 \mathbf{v}_{\text{bank}}입니다.", r"벡터 $\mathbf{v}_{\text{bank}}$입니다."),
    (r"조건 \alpha \geq 1입니다.", r"조건 $\alpha \geq 1$입니다."),
    (r"기울기는 $\nabla f(x)입니다.", r"기울기는 $\nabla f(x)$입니다."),
    (r"값은 \(\alpha + \beta입니다.", r"값은 \(\alpha + \beta\)입니다."),
])
def test_local_repairs_keep_all_mathematical_tokens(before, after):
    assert repair_math_text(before) == after
    validate_math_format(after)
    validate_formatting_only(before, after)


@pytest.mark.parametrize("text", [r"\frac{a}", r"\nabla f(", r"\alpha +", r"$2 + \alpha", r"\frac{a}{"])
def test_incomplete_mathematical_content_stays_unresolved_for_source_based_retry(text):
    assert repair_math_text(text) == text
    assert math_issues(text)
