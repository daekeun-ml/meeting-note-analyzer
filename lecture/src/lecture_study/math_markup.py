"""Context-aware spans for code, paths, URLs and delimited mathematics."""
import re

START = re.compile(r"`+|~{3,}|https?://|(?<![A-Za-z0-9_])[A-Za-z]:\\|\$+|\\[()[\]]")
URL = re.compile(r"https?://[^\s<>(){}]+")
PATH = re.compile(r"[A-Za-z]:\\[^\s<>()]+")


def escaped(text, index):
    start = index
    while start > 0 and text[start - 1] == "\\":
        start -= 1
    return (index - start) % 2 == 1


def math_end(text, start, opener):
    closing = {"$": "$", "$$": "$$", r"\(": r"\)", r"\[": r"\]"}[opener]
    position = start + len(opener)
    while True:
        end = text.find(closing, position)
        if end < 0:
            return None
        if escaped(text, end):
            position = end + len(closing)
            continue
        body = text[start + len(opener):end]
        if not body:
            return None
        if opener == "$":
            if (end + 1 < len(text) and text[end + 1] == "$") or "\n\n" in body:
                return None
            # "$20 ... $\eta$" is currency followed by a new formula, not one long formula.
            after = text[end + 1:end + 2]
            if body[0] in "0123456789" and after and re.match(r"[A-Za-z0-9\\]", after) and (
                body[-1].isspace() or re.search(r"[가-힣]", body)
            ):
                return None
        return end + len(closing)


def markup_spans(text):
    """Yield (kind, start, end). Earlier outer math wins over backticks/URLs inside it."""
    plain, position = 0, 0
    while match := START.search(text, position):
        start, token = match.start(), match.group()
        end, kind = None, "code"
        if token.startswith(("http",)) or re.match(r"[A-Za-z]:\\", token):
            found = (URL if token.startswith("http") else PATH).match(text, start)
            end = found.end()
        elif token[0] in "`~":
            fence = len(token) >= 3 and not text[text.rfind("\n", 0, start) + 1:start].strip()
            if token[0] == "~" and not fence:
                position = match.end()
                continue
            closing = re.search(
                r"(?m)^[ \t]{0,3}" + re.escape(token[0]) + "{" + str(len(token)) + r",}[ \t]*(?:\n|$)" if fence else
                r"(?<!`)" + re.escape(token) + r"(?!`)", text[match.end():])
            if closing:
                end = match.end() + closing.end()
            elif fence:
                end = len(text)  # An unclosed fenced block remains code, as in CommonMark.
        elif token in ("$", "$$", r"\(", r"\[") and not escaped(text, start):
            end, kind = math_end(text, start, token), "math"
        if end is None:
            position = match.end()
            continue
        if plain < start:
            yield "prose", plain, start
        yield kind, start, end
        plain = position = end
    if plain < len(text):
        yield "prose", plain, len(text)


def inline_math_linewrap(token):
    if token.startswith("$") and not token.startswith("$$"):
        return token.replace("\n", " ")
    return token
