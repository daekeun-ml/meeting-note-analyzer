"""Repair presentation escapes without decoding Unicode or LaTeX as JSON."""
import re

CODE = re.compile(r"(```[\s\S]*?```|`[^`\n]*`)")
MATH = re.compile(r"\$\$[\s\S]+?\$\$|(?<!\\)\$(?:\\.|[^$\\\n])+\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]")
COMMANDS = r"arg|max|min|sum|prod|int|lim|log|ln|exp|frac|dfrac|tfrac|sqrt|alpha|beta|gamma|delta|theta|lambda|mu|nu|sigma|phi|omega|eta|nabla|partial|cdots|ldots|times|cdot|left|right|begin|end|text|mathrm|mathbf|mathbb"
DOUBLE_COMMAND = re.compile(r"(?<!\\)\\\\(?=(?:" + COMMANDS + r")(?![A-Za-z])|[()[\]])")
# Recover an unmarked equation before Korean prose, as in "\arg\max_...으로".
# English prose and ambiguous plain-text expressions still require math delimiters.
BARE_MATH = re.compile(r"(?<!\\)\\(?:arg|frac|sum|prod|int|lim|sqrt)(?![A-Za-z])[A-Za-z0-9\\{}()[\]^_=+*/|<>,.:;!?\- \t]*?(?=[가-힣])")


def _prose(text):
    text = re.sub(r"(?<!\\)(?:\\r\\n|\\n){2,}", "\n\n", text)
    text = re.sub(r"(?<!\\)(?:\\r\\n|\\n)(?![A-Za-z])", "\n", text)
    text = re.sub(r'(?<!\\)\\"', '"', text)

    def equation(match):
        raw = match.group()
        expression = raw.rstrip(" .,;:!?\t")
        return "$" + expression + "$" + raw[len(expression):]

    return BARE_MATH.sub(equation, text)


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
