"""Make lost source characters explicit without guessing what the missing text said."""
import re

BAD_UNICODE = re.compile(r"[\ufffd\ud800-\udfff]+")
SOURCE_MARKER = "[unreadable source text]"
DRAFT_MARKER = "[unreadable generated text]"

INTEGRITY_RULES = r"""
Text integrity: [unreadable source text] marks lost characters in extracted text or speech recognition,
not proof that the slide image itself is unreadable. Use readable supplied text or visual evidence to
identify the content; never guess from the damaged word alone. If the supplied evidence is insufficient,
state the specific limitation in ordinary words and leave the missing content unresolved.
Only the marked span is damaged; surrounding readable text remains evidence. A missing symbol in one
expression does not make another term unreadable. If another supplied source clearly resolves a term,
use it without inventing uncertainty about that resolved term or claiming all sources were damaged.
Do not copy bracketed diagnostic markers or broken word fragments into the deliver output.
Never echo a Unicode replacement glyph or an unpaired surrogate, including in quotations or examples
of recognition errors; write "U+FFFD" when discussing the replacement code point itself.
Preserve readable mathematics. For an unresolved symbol, describe what cannot be read; if a math note
depends on that symbol, mark sourceCheck uncertain and do not assert an unsupported correction or proof.
"""


def damaged_paths(value, path=(), *, markers=False):
    if isinstance(value, str):
        return [path] if BAD_UNICODE.search(value) or (markers and any(marker in value for marker in (SOURCE_MARKER, DRAFT_MARKER))) else []
    if isinstance(value, list):
        return [found for index, item in enumerate(value) for found in damaged_paths(item, (*path, index), markers=markers)]
    if isinstance(value, dict):
        found = []
        for key, item in value.items():
            if isinstance(key, str) and BAD_UNICODE.search(key):
                found.append((*path, "<unreadable key>"))
            else:
                found.extend(damaged_paths(item, (*path, key), markers=markers))
        return found
    return []


def field_path(path, root="output"):
    # Diagnostics name structural fields, never quote source text or damaged keys.
    return root + "".join(f"[{key}]" if isinstance(key, int) else
                          "." + key if isinstance(key, str) and re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]{0,79}", key) else
                          ".[key]" for key in path)


def mark_unreadable(value, marker=SOURCE_MARKER):
    if isinstance(value, str):
        text = BAD_UNICODE.sub(lambda _: marker, value)
        return text.replace(SOURCE_MARKER, DRAFT_MARKER) if marker == DRAFT_MARKER else text
    if isinstance(value, list):
        return [mark_unreadable(item, marker) for item in value]
    if isinstance(value, dict):
        if any(isinstance(key, str) and BAD_UNICODE.search(key) for key in value):
            raise ValueError("Unreadable Unicode in an object key; regenerate the structured fields without guessing identifiers.")
        return {key: mark_unreadable(item, marker) for key, item in value.items()}
    return value


def source_text_view(data):
    """Only the per-request model view changes; stored transcripts and original files stay intact."""
    paths = damaged_paths(data)
    if not paths:
        return data
    return {**mark_unreadable(data), "sourceTextIntegrity": {
        "unreadableFieldCount": len(paths),
        "fields": [field_path(path, "input") for path in paths[:30]],
        "marker": SOURCE_MARKER,
        "instruction": "Only the marked spans are recognition/extraction gaps; surrounding text is unchanged. Use readable supplied evidence to resolve them. Do not generalize one gap to unrelated text or guess missing content.",
    }}


def validate_text_integrity(value):
    paths = damaged_paths(value, markers=True)
    if paths:
        locations = ", ".join(field_path(path) for path in paths[:12])
        raise ValueError("Generated text contains a replacement character, invalid Unicode or a diagnostic marker at "
                         + locations + ". Rewrite only the affected content using readable supplied evidence. "
                         "Describe unresolved source text in words; never copy the damaged glyph or guess missing letters.")
