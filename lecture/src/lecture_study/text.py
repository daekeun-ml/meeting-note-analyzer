"""Repair presentation escapes without decoding Unicode or LaTeX as JSON."""
import re

CODE = re.compile(r"(```[\s\S]*?```|`[^`\n]*`|https?://[^\s<>()]+)")
MATH = re.compile(r"\$\$[\s\S]+?\$\$|(?<!\\)\$(?:\\.|[^$\\\n])+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]")
COMMANDS = r"arg|max|min|sum|prod|int|lim|log|ln|exp|frac|dfrac|tfrac|sqrt|alpha|beta|gamma|delta|theta|lambda|mu|nu|sigma|phi|omega|eta|nabla|partial|cdots|ldots|times|cdot|left|right|begin|end|text|mathrm|mathbf|mathbb"
DOUBLE_COMMAND = re.compile(r"(?<!\\)\\\\(?=(?:" + COMMANDS + r")(?![A-Za-z])|[()[\]])")
# Recover an unmarked equation before Korean prose, as in "\arg\max_...으로".
# English prose and ambiguous plain-text expressions still require math delimiters.
BARE_MATH = re.compile(r"(?<!\\)\\(?:arg|frac|sum|prod|int|lim|sqrt)(?![A-Za-z])[A-Za-z0-9\\{}()[\]^_=+*/|<>,.:;!?\- \t]*?(?=[가-힣])")
GREEK = dict(zip("αβγδεηθλμνπρστφψωΓΔΘΛΣΦΨΩ", "alpha beta gamma delta epsilon eta theta lambda mu nu pi rho sigma tau phi psi omega Gamma Delta Theta Lambda Sigma Phi Psi Omega".split()))
ATOM = r"(?:\d+(?:\.\d+)?|[A-Za-zα-ωΑ-Ω](?:[_^](?:\{[^{}\n]+\}|[A-Za-z0-9]+))*)"
LEGACY_EXPRESSION = re.compile(r"(?<![A-Za-z0-9_./:\\])" + ATOM + r"(?:[+\-*/=]" + ATOM + r")*(?![A-Za-z0-9_])")


def _legacy_math(match):
    raw = match.group()
    if not re.search(r"[α-ωΑ-Ω_^]", raw) and not re.fullmatch(r"[a-z]/[A-Za-z]", raw):
        return raw
    latex = re.sub(r"[α-ωΑ-Ω]", lambda m: "\\" + GREEK[m.group()] + " " if m.group() in GREEK else m.group(), raw)
    def script(m):
        value = m[2]
        if m[1] == "_" and re.fullmatch(r"[A-Za-z]{2,}", value):
            value = r"\mathrm{" + value + "}"
        return m[1] + "{" + value + "}"
    return "$" + re.sub(r"([_^])([A-Za-z0-9]+)", script, latex).strip() + "$"


def _prose(text):
    text = re.sub(r"(?<!\\)(?:\\r\\n|\\n){2,}", "\n\n", text)
    text = re.sub(r"(?<!\\)(?:\\r\\n|\\n)(?![A-Za-z])", "\n", text)
    text = re.sub(r'(?<!\\)\\"', '"', text)

    def equation(match):
        raw = match.group()
        expression = raw.rstrip(" .,;:!?\t")
        return "$" + expression + "$" + raw[len(expression):]

    value = BARE_MATH.sub(equation, text)
    parts, end = [], 0
    for match in MATH.finditer(value):
        parts.extend((LEGACY_EXPRESSION.sub(_legacy_math, value[end:match.start()]), match.group()))
        end = match.end()
    return "".join(parts) + LEGACY_EXPRESSION.sub(_legacy_math, value[end:])


def normalize_text(text: str) -> str:
    def chunk(value):
        value = DOUBLE_COMMAND.sub(lambda _: "\\", value)
        parts, end = [], 0
        for match in MATH.finditer(value):
            parts.extend((_prose(value[end:match.start()]), match.group()))
            end = match.end()
        parts.append(_prose(value[end:]))
        return "".join(parts)

    return "".join(part if i % 2 else chunk(part) for i, part in enumerate(CODE.split(text.replace("\r\n", "\n"))))


def normalize_generated_text(value):
    if isinstance(value, str):
        return normalize_text(value)
    if isinstance(value, list):
        return [normalize_generated_text(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize_generated_text(item) for key, item in value.items()}
    return value


def validate_math_format(value, path="output"):
    """Catch recognizable unclosed/unmarked formulas and request a grounded repair."""
    if isinstance(value, dict):
        for key, item in value.items():
            validate_math_format(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            validate_math_format(item, f"{path}[{index}]")
    elif isinstance(value, str):
        for index, part in enumerate(CODE.split(value)):
            if index % 2:
                continue
            prose = MATH.sub("", part)
            if re.search(r"(?<!\\)\\(?:" + COMMANDS + r")(?![A-Za-z])|(?<!\\)\$(?=[A-Za-z\\({])", prose):
                raise ValueError(f"{path}: put complete formulas and mathematical symbols inside $...$ or $$...$$. Preserve the source meaning and do not delete the formula.")
