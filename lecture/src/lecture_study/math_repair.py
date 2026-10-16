"""Insert math wrappers only where expression boundaries are explicit; preserve all content."""
import copy
import re
from collections import Counter

from .text import CODE, math_issues

COMMAND = re.compile(r"\\(?:[A-Za-z]+|[,;! ])")
NUMBER = re.compile(r"\d+(?:\.\d+)?")
FUNCTION = re.compile(r"(?:[A-Za-z]|sin|cos|tan|log|exp|max|min)(?=\()")
OPERATORS = set("=+-*/<>|:≤≥≠≈×·")
PREFIX_OPERATORS = {r"\nabla", r"\partial", r"\log", r"\ln", r"\sin", r"\cos", r"\max", r"\min", r"\lim", r"\sum", r"\prod", r"\int"}
BINARY_COMMANDS = {r"\le", r"\leq", r"\ge", r"\geq", r"\neq", r"\in", r"\notin", r"\approx", r"\equiv",
                   r"\sim", r"\times", r"\cdot", r"\to", r"\mapsto", r"\mid", r"\land", r"\lor"}


def formatting_fingerprint(text):
    """Preserve protected literals and word boundaries while ignoring math wrappers."""
    parts = []
    for index, part in enumerate(CODE.split(text)):
        if index % 2:
            parts.append(("literal", part))
        else:
            part = re.sub(r"(?<!\\)\\[()[\]]|(?<!\\)\$", "", part)
            parts.append(("text", re.sub(r"\s+", " ", part)))
    if parts:
        parts[0] = (parts[0][0], parts[0][1].lstrip())
        parts[-1] = (parts[-1][0], parts[-1][1].rstrip())
    return parts


def validate_formatting_only(before, after):
    if formatting_fingerprint(before) != formatting_fingerprint(after):
        raise ValueError("Formatting repair changed content; preserve prose, formulas, signs, variables and protected literals.")
    currency = Counter(re.findall(r"(?<!\\)\$\d+(?:[.,]\d+)*", before))
    updated = Counter(re.findall(r"(?<!\\)\$\d+(?:[.,]\d+)*", after))
    if currency - updated:
        raise ValueError("Preserve existing dollar amounts and numeric math openings.")


def group_end(text, start):
    """Read complete nested argument groups, including Korean text inside TeX arguments."""
    pairs = {"{": "}", "(": ")", "[": "]"}
    stack, i = [], start
    while i < len(text):
        char = text[i]
        if char == "\\":
            if i + 1 < len(text) and text[i + 1] in "{}()[]$\\":
                i += 2
                continue
        elif char in pairs:
            stack.append(pairs[char])
        elif char in "})]":
            if not stack or char != stack.pop():
                return None
            if not stack:
                return i + 1
        elif char == "$":
            return None
        i += 1
    return None


def atom_end(text, start):
    if start >= len(text):
        return None
    if text[start] in "+-":
        return atom_end(text, start + 1)
    match = COMMAND.match(text, start)
    if match:
        end = match.end()
        # An unmarked environment needs full source-based repair, not guessed boundaries.
        if match.group() in (r"\begin", r"\end", r"\left", r"\right"):
            return None
    elif text[start] in "{([":
        return group_end(text, start)
    elif number := NUMBER.match(text, start):
        end = number.end()
    elif function := FUNCTION.match(text, start):
        end = function.end()
    elif text[start].isascii() and text[start].isalpha():
        end = start + 1
        if end < len(text) and text[end].isascii() and text[end].isalpha():
            return None  # Do not consume ordinary English prose.
    else:
        return None
    groups = 0
    while end < len(text):
        if text[end] in "{([":
            end = group_end(text, end)
            if end is None:
                return None
            groups += 1
        elif text[end] in "_^":
            script = end + 1
            if script >= len(text):
                return None
            if text[script] in "{([":
                end = group_end(text, script)
            elif text[script] == "\\":
                end = atom_end(text, script)
            elif text[script].isascii() and text[script].isalnum():
                end = script + 1  # LaTeX consumes exactly one unbraced script token.
            else:
                return None
            if end is None:
                return None
        else:
            break
    if match and match.group() in (r"\frac", r"\dfrac", r"\tfrac") and groups < 2:
        return None
    return end


def expression_end(text, start):
    end = atom_end(text, start)
    if end is None:
        return None
    initial = COMMAND.match(text, start)
    operand = bool(initial and initial.group() in PREFIX_OPERATORS)
    while end < len(text):
        next_start = end
        while next_start < len(text) and text[next_start] in " \t":
            next_start += 1
        if next_start >= len(text):
            break
        command = COMMAND.match(text, next_start)
        if text[next_start] in OPERATORS or (command and command.group() in BINARY_COMMANDS):
            after = command.end() if command else next_start + 1
            if not command:
                while after < len(text) and text[after] in OPERATORS:
                    after += 1
            while after < len(text) and text[after] in " \t":
                after += 1
            tail = atom_end(text, after)
            if tail is None:
                return None  # Never wrap an incomplete relation as though it were complete.
            end, operand = tail, False
        elif text[next_start] == "\\" or operand:
            tail = atom_end(text, next_start)
            if tail is None:
                if text[next_start] in "\\{([" or FUNCTION.match(text, next_start):
                    return None
                break
            end, operand = tail, False
        else:
            break
    return end


def repair_math_text(text):
    """Ambiguous/incomplete expressions stay visible to the regular validation retry."""
    original = text
    for _ in range(128):
        changed = False
        for issue in math_issues(text):
            start = issue["offset"]
            opener = next((token for token in ("$$", "$", r"\(", r"\[") if text.startswith(token, start)), None)
            if opener:
                content = start + len(opener)
                while content < len(text) and text[content] in " \t\n":
                    content += 1
                end = expression_end(text, content)
                if end is not None and end > content:
                    close = {"$": "$", "$$": "$$", r"\(": r"\)", r"\[": r"\]"}[opener]
                    text = text[:end] + close + text[end:]
                    changed = True
                    break
            elif issue["reason"] == "bare LaTeX command":
                dollar = text.rfind("$", 0, start)
                prefix = text[dollar + 1:start] if dollar >= 0 else ""
                if prefix and re.fullmatch(r"\d[0-9.+*/=<>_^{}\s-]*", prefix) and re.search(r"[+*/=<>_^{}-]", prefix):
                    continue  # An earlier numeric math opener needs its own closing delimiter.
                end = expression_end(text, start)
                if end is not None:
                    text = text[:start] + "$" + text[start:end] + "$" + text[end:]
                    changed = True
                    break
        if not changed:
            break
    validate_formatting_only(original, text)
    return text


def repair_generated_math(value):
    # Formatting is local and deterministic: no extra LLM calls or invented math.
    paths = list(dict.fromkeys(issue["path"] for issue in math_issues(value)))
    if not paths:
        return value
    repaired = copy.deepcopy(value)
    for path in paths:
        target = repaired
        for key in path[:-1]:
            target = target[key]
        if path:
            target[path[-1]] = repair_math_text(target[path[-1]])
    return repaired
