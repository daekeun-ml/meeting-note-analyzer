"""Repair presentation escapes without decoding Unicode or LaTeX as JSON."""
import re
from .math_markup import inline_math_linewrap, markup_spans

CODE = re.compile(r"(```[\s\S]*?```|`[^`\n]*`|https?://[^\s<>(){}]+|[A-Za-z]:\\[^\s<>()]+)")
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
        if expression.count("{") != expression.count("}"):
            return raw  # A Korean word inside \text{...} is not the end of the formula.
        return "$" + expression + "$" + raw[len(expression):]

    value = BARE_MATH.sub(equation, text)
    parts = []
    for kind, start, end in markup_spans(value):
        part = value[start:end]
        parts.append(LEGACY_EXPRESSION.sub(_legacy_math, part) if kind == "prose" else part)
    return "".join(parts)


def normalize_text(text: str) -> str:
    def chunk(value):
        value = DOUBLE_COMMAND.sub(lambda _: "\\", value)
        parts = []
        for kind, start, end in markup_spans(value):
            part = value[start:end]
            parts.append(_prose(part) if kind == "prose" else inline_math_linewrap(part) if kind == "math" else part)
        return "".join(parts)

    value = text.replace("\r\n", "\n")
    return "".join(value[start:end] if kind == "code" else chunk(value[start:end])
                   for kind, start, end in markup_spans(value))


def normalize_generated_text(value):
    if isinstance(value, str):
        return normalize_text(value)
    if isinstance(value, list):
        return [normalize_generated_text(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize_generated_text(item) for key, item in value.items()}
    return value


def math_issues(value, path=()):
    """Return structural paths and precise positions without logging source prose."""
    if isinstance(value, dict):
        found = []
        for key, item in value.items():
            found.extend(math_issues(item, (*path, key)))
        return found
    elif isinstance(value, list):
        found = []
        for index, item in enumerate(value):
            found.extend(math_issues(item, (*path, index)))
        return found
    elif isinstance(value, str):
        found = []
        for kind, start, end in markup_spans(value):
            if kind != "prose":
                continue
            for match in re.finditer(r"(?<!\\)\\(?:" + COMMANDS + r")(?![A-Za-z])|(?<!\\)\$(?=[A-Za-z\\({])|(?<!\\)\\[()[\]]", value[start:end]):
                offset = start + match.start()
                found.append({"path": path, "offset": offset, "line": value.count("\n", 0, offset) + 1,
                              "column": offset - value.rfind("\n", 0, offset),
                              "reason": "bare LaTeX command" if re.match(r"\\[A-Za-z]", match.group()) else "unclosed math delimiter"})
        return found
    return []


def validate_math_format(value, path="output"):
    from .text_integrity import field_path
    issues = math_issues(value)
    if issues:
        issue = issues[0]
        location = field_path(issue["path"], path)
        raise ValueError(f"{location} (line {issue['line']}, column {issue['column']}, {issue['reason']}): "
                         "put complete formulas and mathematical symbols inside $...$ or $$...$$. "
                         "Preserve the source meaning and do not delete the formula.")
