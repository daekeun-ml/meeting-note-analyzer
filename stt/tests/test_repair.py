from stt.repair import align_clean_words, has_corruption
from stt.schemas import Word


def W(t, s, e):
    return Word(w=t, s=s, e=e)


def test_equal_length_replace_keeps_timings():
    timed = [W("좋습니다.", 0, 1), W("서연님,", 1, 2), W("부탁드���요.", 2, 3)]
    out = align_clean_words(timed, "좋습니다. 서연님, 부탁드려요.")
    assert [w.w for w in out] == ["좋습니다.", "서연님,", "부탁드려요."]
    assert [(w.s, w.e) for w in out] == [(0, 1), (1, 2), (2, 3)]
    assert has_corruption(timed) and not has_corruption(out)


def test_unequal_replace_spreads_time_by_length():
    timed = [W("결재", 0, 1), W("실������", 1, 4), W("합니다.", 4, 5)]
    out = align_clean_words(timed, "결재 실패로 처리 합니다.")
    assert [w.w for w in out] == ["결재", "실패로", "처리", "합니다."]
    assert out[1].s == 1.0 and abs(out[2].e - 4.0) < 1e-6 and out[3].e == 5


def test_insert_interpolates_and_delete_drops_noise():
    timed = [W("hello", 0, 1), W("�", 1, 1.2), W("world", 2, 3)]
    out = align_clean_words(timed, "hello big world")
    assert [w.w for w in out] == ["hello", "big", "world"]
    assert 1.0 <= out[1].s <= out[1].e <= 2.0


def test_empty_inputs_are_safe():
    assert align_clean_words([], "x") == []
    timed = [W("a", 0, 1)]
    assert align_clean_words(timed, "") == timed
