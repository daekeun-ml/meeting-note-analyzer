from meeting_agents import sanitize
from meeting_agents.attribution import reconcile_attribution
from meeting_agents.schemas import validate


def test_attribution_names_and_reasons_are_cleaned_but_quotes_stay_verbatim():
    segment_text = "저는 김민수·PM입니다 — 반갑습니다."
    transcript = {"meetingId": "m1", "durationSec": 10, "speakers": [], "segments": [
        {"id": "seg-0", "speaker": "S1", "start": 0, "end": 5, "text": segment_text, "words": []},
    ]}
    draft = validate("speaker_attribution", {
        "speakers": [{"id": "S1", "label": "김민수·PM", "name": "김민수", "role": "PM — 리드", "confidence": 0.95, "evidence": ["자기소개 → 이름 확인"],
                      "decision": "confirmed", "basis": "explicit_identity", "support": [{"segmentId": "seg-0", "quote": segment_text}]}],
        "merges": [], "relabels": [], "notes": "화자 2·3 구분 불확실",
    })
    cleaned = sanitize.clean_attribution(draft)
    assert cleaned["speakers"][0]["label"] == "김민수, PM" and cleaned["speakers"][0]["role"] == "PM - 리드"
    assert cleaned["speakers"][0]["evidence"] == ["자기소개 -> 이름 확인"] and cleaned["notes"] == "화자 2, 3 구분 불확실"
    assert cleaned["speakers"][0]["support"][0]["quote"] == segment_text  # verbatim, so the quote still verifies
    safe, out = reconcile_attribution(transcript, cleaned)
    assert not safe["reviewItems"]
    assert out["segments"][0]["speakerLabel"] == "김민수, PM"
