import pytest

from lecture_study.text import normalize_text


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
