"""A reviewable overall inclination based on this interview's grounded competency assessments."""
import hashlib
import json
import logging
import re
from typing import Literal

from botocore.exceptions import ClientError
from pydantic import Field, create_model

from .interview_criteria import CRITERION_GUIDE, CRITERION_LEVEL_GUIDE, LABELS
from .schemas import Strict

log = logging.getLogger(__name__)
SUMMARY_VERSION = "v1"


class OverallSummaryDraft(Strict):
    barAssessment: Literal["clear", "borderline", "below_bar"]
    reason: str = Field(min_length=1, max_length=600)
    rationale: str = Field(min_length=1, max_length=4000)


SUMMARY_TASK = """Write the overall Summary for a HUMAN INTERVIEWER TO REVIEW, in opinionLanguage.
This is an advisory inclination for the competencies evaluated in THIS interview, not a final hiring action.
Use ONLY the supplied grounded competency assessments. Do not invent interview facts or import example feedback.
Respect targetLevel, roleTitle and roleContext. Do not change any competency rating.
Assess the selected job-related scope; never claim that unasked competencies were failed.
UnassessedCriteria are coverage limitations, not proof of weak competence, and are not negative evidence.
Classify barAssessment:
- clear: convincing independent evidence that the evaluated competencies meet the target-level bar, without
  unresolved material gaps. This classification is available only when clearAllowed is true.
- borderline: mixed, limited, or unresolved evidence around the target-level bar.
- below_bar: demonstrated material depth, experience, ownership or design gaps below the target-level bar.
The application maps clear to Inclined and BOTH borderline and below_bar to Not Inclined. There is no third decision.
Do not average scores or let application/tool exposure cancel a core reasoning or design gap.
Even when clearAllowed is true, unresolved material concerns can still justify borderline or below_bar.
Recognize demonstrated strengths briefly, then explain the decisive gaps and their implications for the target role.
Separate hands-on exposure from explanatory depth, experiments from production ownership, and independent reasoning
from interviewer-supplied hints. Preserve uncertainty and self-report qualifiers; do not infer inability from missing data.
If the assessments describe a tested resume shortfall, summarize it without repeating resume claim IDs.
reason: ONE short clause explaining the inclination, e.g. 'based on ...' in English. Do NOT include the decision label.
rationale: ONE concise paragraph, about 100–150 English words or 4–6 short Korean sentences.
Lead with the overall role/level implication, support it with the most decisive evidence, and conclude with the
remaining confidence or concern. Avoid an exhaustive question-by-question list, repeated caveats and generic praise.
Do not include internal IDs, bullet markers, protected characteristics, personality judgments or hiring-process actions.
Return only barAssessment, reason and rationale."""


def inclination(bar_assessment):
    return {"clear": "Inclined", "borderline": "Not Inclined", "below_bar": "Not Inclined"}[bar_assessment]


def _reason(text):
    return re.sub(r"^(?:Not Inclined|Inclined)\b[\s,:—–.-]*", "", text.strip(), flags=re.I).strip()


def overall_summary(assessments, settings, level_guide, model, cache, *, reviewable=True):
    """Retain scores and citations in application code; the model only supplies the overall interpretation."""
    observed = [a for a in assessments if a["rating"] is not None and (a["positives"] or a["concerns"])]
    if not reviewable or not observed:
        return None
    references = list(dict.fromkeys(qid for a in observed for field in ("positives", "concerns")
                                    for point in a[field] for qid in point["exchangeIds"]))
    if not references:
        return None
    clear_allowed = all(a["rating"] >= 4 and a["evidenceStatus"] == "sufficient" for a in observed)
    allowed = ("clear", "borderline", "below_bar") if clear_allowed else ("borderline", "below_bar")
    schema = create_model("InterviewOverallSummary", __base__=OverallSummaryDraft,
                          barAssessment=(Literal.__getitem__(allowed), ...))
    data = {
        "targetLevel": settings["targetLevel"], "levelGuide": level_guide,
        "roleTitle": settings["roleTitle"], "roleContext": settings.get("roleContext", ""),
        "opinionLanguage": settings["opinionLanguage"], "clearAllowed": clear_allowed,
        "unassessedCriteria": [LABELS.get(a["criterion"], a["criterion"]) for a in assessments if a not in observed],
        "assessments": [{"criterion": LABELS.get(a["criterion"], a["criterion"]), "rating": a["rating"],
                        "evidenceStatus": a["evidenceStatus"], "levelAssessment": a["levelAssessment"],
                        "positives": [p["text"] for p in a["positives"]],
                        "concerns": [p["text"] for p in a["concerns"]]} for a in observed],
    }
    task = SUMMARY_TASK
    if any(a["criterion"] == "technical_communication" for a in assessments):
        data["communicationContext"] = {
            "criterionGuide": CRITERION_GUIDE["technical_communication"],
            "levelGuide": CRITERION_LEVEL_GUIDE["technical_communication"][settings["targetLevel"]],
        }
        if all(a["criterion"] == "technical_communication" for a in observed):
            data["levelGuide"] = data["communicationContext"]["levelGuide"]
        task += ("\nKeep Technical Communication separate from domain knowledge and architecture. "
                 "Its strengths/gaps concern audience adaptation, shared understanding and stakeholder alignment; "
                 "do not reinterpret its rating as a domain-depth rating or penalize unasked technical dimensions.")
    signature = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]

    def validate(value):
        if value.barAssessment == "clear" and not clear_allowed:
            raise ValueError("Mixed, concerning or limited observed evidence cannot support Inclined; use borderline or below_bar")
        if not _reason(value.reason):
            raise ValueError("Give a brief reason, not just the inclination label")
        if re.search(r"\b(?:seg-\d+|[qr]\d+|S\d+)\b", value.reason + " " + value.rationale):
            raise ValueError("Summary prose must omit internal source IDs")

    try:
        value = schema.model_validate(cache(f"overall-summary-{SUMMARY_VERSION}-{signature}",
            lambda: model.generate(schema, task, data, validate=validate).model_dump()))
        validate(value)
    except (ValueError, ClientError):
        # A model/format problem is never a reason to recommend against a candidate or discard completed notes.
        log.warning("Overall Summary unavailable; retaining the validated interview assessments")
        return None
    except RuntimeError as error:
        if not str(error).startswith("Lecture model-call limit reached"):
            raise
        log.warning("No model budget left for overall Summary")
        return None
    return {
        "recommendation": inclination(value.barAssessment), "barAssessment": value.barAssessment,
        "reason": re.sub(r"\s+", " ", _reason(value.reason)),
        "rationale": re.sub(r"\s+", " ", value.rationale).strip(),
        "criterionIds": [a["criterion"] for a in observed], "exchangeIds": references,
    }
