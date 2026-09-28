import copy

import pytest

from lecture_study.interview_summary import OverallSummaryDraft, inclination, overall_summary
from test_pipeline import FakeStore

SETTINGS = {"targetLevel": "L6", "roleTitle": "AI Specialist Solutions Architect", "roleContext": "Technical advisory scope",
            "opinionLanguage": "en", "interviewerNotes": "Private memo must not become evidence"}


def assessment(criterion="domain_depth", rating=3, evidence="sufficient", qid="q1"):
    return {"criterion": criterion, "rating": rating, "evidenceStatus": evidence,
            "positives": [{"text": "Independent implementation reasoning.", "exchangeIds": [qid]}] if rating else [],
            "concerns": [{"text": "The probed core mechanism was not explained independently.", "exchangeIds": [qid]}] if rating and rating < 4 else [],
            "levelAssessment": "The evidence is scoped to the topics probed.", "followUps": ["An unasked follow-up is not negative evidence."]}


class Model:
    def __init__(self, bar):
        self.bar, self.calls, self.inputs = bar, 0, []
    def generate(self, schema, task, data, validate=None):
        self.calls += 1
        self.inputs.append(copy.deepcopy(data))
        value = schema(barAssessment=self.bar, reason="based on the evaluated technical depth.",
                       rationale="The interview established practical exposure with the scope and limitations described in the competency assessments.")
        validate(value)
        return value


def test_borderline_always_maps_to_not_inclined_even_when_scores_are_strong():
    assert inclination("borderline") == "Not Inclined"
    result = overall_summary([assessment(rating=4)], SETTINGS, "Working L6 guide", Model("borderline"), FakeStore(None).cached)
    assert result["recommendation"] == "Not Inclined"
    assert result["barAssessment"] == "borderline"


@pytest.mark.parametrize("rating,evidence", [(1, "sufficient"), (2, "sufficient"), (3, "sufficient"), (4, "limited")])
def test_mixed_concerning_or_limited_evidence_cannot_produce_inclined(rating, evidence):
    model = Model("clear")
    result = overall_summary([assessment(rating=rating, evidence=evidence)], SETTINGS, "L6 guide", model, FakeStore(None).cached)
    assert model.inputs[0]["clearAllowed"] is False
    assert result is None  # Invalid model output is not a hiring recommendation or a failed interview.
    correct = overall_summary([assessment(rating=rating, evidence=evidence)], SETTINGS, "L6 guide", Model("borderline"), FakeStore(None).cached)
    assert correct["recommendation"] == "Not Inclined"


def test_clear_observed_strengths_can_be_inclined_and_unasked_competencies_are_not_penalties():
    rows = [assessment(rating=4), assessment("dive_deep", None, "not_observed")]
    model = Model("clear")
    result = overall_summary(rows, SETTINGS, "L6 guide", model, FakeStore(None).cached)
    assert result["recommendation"] == "Inclined"
    assert result["criterionIds"] == ["domain_depth"]
    assert model.inputs[0]["unassessedCriteria"] == ["Dive Deep"]
    assert len(model.inputs[0]["assessments"]) == 1


def test_summary_citations_are_derived_from_validated_assessments_and_cache_tracks_their_content():
    rows = [assessment(qid="q1"), assessment("system_architecture", 2, qid="q2")]
    before = copy.deepcopy(rows)
    model, store = Model("below_bar"), FakeStore(None)
    result = overall_summary(rows, SETTINGS, "L6 guide", model, store.cached)
    assert result["exchangeIds"] == ["q1", "q2"]
    assert rows == before
    assert "exchangeIds" not in str(model.inputs) and "q1" not in str(model.inputs)
    assert "Private memo" not in str(model.inputs) and "followUps" not in str(model.inputs)
    assert overall_summary(rows, SETTINGS, "L6 guide", model, store.cached) == result
    assert model.calls == 1
    rows[0]["concerns"][0]["text"] = "A different supported finding."
    overall_summary(rows, SETTINGS, "L6 guide", model, store.cached)
    assert model.calls == 2


def test_missing_or_unreviewable_evidence_does_not_become_an_automatic_negative_recommendation():
    model, store = Model("below_bar"), FakeStore(None)
    assert overall_summary([assessment(rating=None, evidence="not_observed")], SETTINGS, "L6", model, store.cached) is None
    assert overall_summary([assessment()], SETTINGS, "L6", model, store.cached, reviewable=False) is None
    assert model.calls == 0


def test_validation_failure_keeps_prior_assessments_and_cancellation_still_stops_the_run():
    class FailedModel:
        error = ValueError("Invalid summary")
        def generate(self, *args, **kwargs):
            raise self.error
    rows, model = [assessment()], FailedModel()
    before = copy.deepcopy(rows)
    assert overall_summary(rows, SETTINGS, "L6", model, FakeStore(None).cached) is None
    assert rows == before
    model.error = RuntimeError("Lecture execution is no longer active")
    with pytest.raises(RuntimeError, match="no longer active"):
        overall_summary(rows, SETTINGS, "L6", model, FakeStore(None).cached)


def test_unknown_source_ids_and_duplicate_decision_only_reasons_are_not_accepted():
    class InvalidModel:
        def generate(self, schema, task, data, validate=None):
            value = OverallSummaryDraft(barAssessment="below_bar", reason="Not Inclined", rationale="See q999.")
            validate(value)
            return value
    assert overall_summary([assessment()], SETTINGS, "L6", InvalidModel(), FakeStore(None).cached) is None
