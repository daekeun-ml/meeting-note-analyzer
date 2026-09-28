"""Shared bounded study generation and references to supplied source pages."""
import json

from .schemas import Study
from .customization import request_task


def deck_context(record, slides, readings):
    # Leave room for speech, the current page and images within the model input limit.
    budget = max(300, 72_000 // max(1, len(slides)) - 200)
    return {"fileName": record["assets"].get("slides", {}).get("fileName", ""),
            "pages": [{"page": slide["page"], "title": reading["title"][:100],
                       "text": slide["text"][:budget * 2 // 3],
                       "description": reading["description"][:budget // 3]}
                      for slide, reading in zip(slides, readings, strict=True)]}


def validate_references(study, context):
    supplied = {page["page"] for page in context.get("pages", [])}
    if any(reference.page not in supplied for reference in study.relatedPages):
        raise ValueError("Related pages must refer only to supplied source pages")
    for note in study.mathNotes:
        if note.sourceCheck and note.sourceCheck.status == "corrected" and not note.sourceCheck.correctedStatement:
            raise ValueError("A demonstrated source correction requires the corrected statement")


def generate_study(model, task, base, evidence, pictures=None):
    task = request_task(task, base)
    groups, current, size = [], [], 0
    for item in evidence:
        length = len(json.dumps(item, ensure_ascii=False))
        if length > 30_000:
            raise ValueError("A speech segment exceeds the study context limit")
        if current and size + length > 30_000:
            groups.append(current)
            current, size = [], 0
        current.append(item)
        size += length
    groups.append(current)
    context = base.get("sourceContext", {})
    validate = lambda study: validate_references(study, context)
    parts = [model.generate(Study, task, {**base, "recordedSpeech": group}, images=pictures or [], validate=validate).model_dump() for group in groups]
    while len(parts) > 1:
        parts = [model.generate(Study, task + " Consolidate these notes, retaining source corrections and references without adding lecture claims.",
                                {**base, "notes": parts[i:i + 2]}, validate=validate).model_dump()
                 for i in range(0, len(parts), 2)]
    return parts[0]
