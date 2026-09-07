from stt.align import Turn, assign_speakers, build_segments, relabel_speakers, speaker_stats
from stt.schemas import Word


def W(text, s, e):
    return Word(w=text, s=s, e=e)


def test_relabel_orders_by_first_appearance():
    turns = [Turn(5, 8, "SPEAKER_01"), Turn(0, 4, "SPEAKER_00"), Turn(9, 12, "SPEAKER_01")]
    relabeled, mapping = relabel_speakers(turns)
    assert mapping == {"SPEAKER_00": "S1", "SPEAKER_01": "S2"}
    assert {t.speaker for t in relabeled} == {"S1", "S2"}


def test_assign_uses_max_overlap_then_nearest():
    turns = [Turn(0, 4, "S1"), Turn(4, 8, "S2")]
    words = [W(" hi", 0.5, 1.0), W(" there", 3.8, 4.5), W(" late", 9.0, 9.5)]
    assert assign_speakers(words, turns) == ["S1", "S2", "S2"]


def test_assign_without_turns_defaults():
    assert assign_speakers([W("a", 0, 1)], []) == ["S1"]


def test_build_segments_breaks_on_speaker_gap_and_sentence():
    words = [W(" Hello", 0, 0.5), W(" team.", 0.6, 1.0), W(" Next", 1.2, 1.5), W(" item", 1.6, 2.0), W(" yes", 5.0, 5.3), W(" go", 5.4, 5.6)]
    speakers = ["S1", "S1", "S1", "S1", "S2", "S2"]
    segs = build_segments(words, speakers)
    assert [s.text for s in segs] == ["Hello team.", "Next item", "yes go"]
    assert [s.speaker for s in segs] == ["S1", "S1", "S2"]
    assert segs[0].id == "seg-0001" and segs[2].id == "seg-0003"
    assert segs[2].start == 5.0 and segs[2].end == 5.6


def test_join_handles_tokens_without_spaces_and_punctuation():
    words = [W("안녕하세요", 0, 0.5), W("여러분", 0.6, 1.0), W(",", 1.0, 1.0), W("시작합니다", 1.1, 1.8)]
    segs = build_segments(words, ["S1"] * 4)
    assert segs[0].text == "안녕하세요 여러분, 시작합니다"


def test_speaker_stats_sorted_desc():
    words = [W(" a", 0, 1), W(" b", 1, 2), W(" c", 2, 6)]
    segs = build_segments(words, ["S1", "S1", "S2"])
    stats = speaker_stats(segs)
    assert stats[0].id == "S2" and stats[0].talkTimeSec == 4.0
    assert stats[1].id == "S1" and stats[1].talkTimeSec == 2.0
