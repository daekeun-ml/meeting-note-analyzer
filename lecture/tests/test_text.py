import pytest

from lecture_study.text import normalize_text, validate_math_format


@pytest.mark.parametrize("text,expected", [
    (r'\"Language Model\"을 다룹니다.\n\n다음 주제입니다.', '"Language Model"을 다룹니다.\n\n다음 주제입니다.'),
    (r"첫 줄입니다.\n둘째 줄입니다.", "첫 줄입니다.\n둘째 줄입니다."),
    (r"수식 \\arg\\max_\\theta \\sum_t \\log P(w^t|w^1,\\cdots,w^{t-1},\\theta)으로 설명합니다.",
     r"수식 $\arg\max_\theta \sum_t \log P(w^t|w^1,\cdots,w^{t-1},\theta)$으로 설명합니다."),
    (r"기울기 $\nabla f(x)$와 $\nu \neq 0$, $\theta$입니다.", r"기울기 $\nabla f(x)$와 $\nu \neq 0$, $\theta$입니다."),
    (r"\[\begin{matrix}a & b \\ c & d\end{matrix}\]", r"\[\begin{matrix}a & b \\ c & d\end{matrix}\]"),
    (r"`print('\n')`와 `\\theta`는 코드입니다.", r"`print('\n')`와 `\\theta`는 코드입니다."),
    ("```python\nprint(r'\\n\\n')\n```", "```python\nprint(r'\\n\\n')\n```"),
    (r"줄바꿈 명령 \n과 경로 C:\new\notes", "줄바꿈 명령 \n과 경로 C:\\new\\notes"),
])
def test_repairs_only_presentation_escapes_and_is_idempotent(text, expected):
    assert normalize_text(text) == expected
    assert normalize_text(expected) == expected


def test_legacy_greek_symbols_scripts_and_ratios_become_delimited_latex_without_changing_identifiers():
    value = normalize_text("학습률 η, η_opt, 누적값 v^t, 진행도 t/T, 분모 1-α^t.")
    assert r"$\eta$" in value and r"\mathrm{opt}" in value and "$v^{t}$" in value and "$t/T$" in value
    assert r"$1-\alpha ^{t}$" in value
    validate_math_format({"overview": value})
    assert normalize_text(value) == value
    untouched = "file_name, module_id, https://example.org/v_t, `v^t`"
    assert normalize_text(untouched) == untouched


def test_unclosed_or_unmarked_latex_requests_repair_but_currency_and_code_are_not_formulas():
    for text in (r"기울기 \nabla f(x)", r"공식 $\alpha + x"):
        with pytest.raises(ValueError, match=r"output.overview"):
            validate_math_format({"overview": text})
    validate_math_format({"overview": r"비용 $20, `\nabla f(x)` 코드와 $\eta$ 수식"})
