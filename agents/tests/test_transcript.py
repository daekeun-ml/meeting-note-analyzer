import json
from pathlib import Path

from meeting_agents.transcript import Transcript, apply_attribution, hms


def sample():
    segs = [
        {"id": f"seg-{i:04d}", "start": i * 100.0, "end": i * 100.0 + 50, "speaker": "S1" if i % 2 == 0 else "S2", "text": f"line {i}", "words": []}
        for i in range(12)
    ]
    return {"version": 1, "meetingId": "m", "language": "ko", "durationSec": 1150.0, "mode": "intended", "model": "x", "speakers": [{"id": "S1", "talkTimeSec": 300}, {"id": "S2", "talkTimeSec": 300}], "segments": segs, "stats": {}}


def test_chunks_cover_all_segments_once():
    t = Transcript(sample())
    chunks = t.chunks(5)
    ids = [s["id"] for _, _, _, segs in chunks for s in segs]
    assert sorted(ids) == sorted(s["id"] for s in t.segments)
    assert chunks[0][1] == 0.0 and chunks[-1][2] <= 1150.0 + 1e-6


def test_write_chunks_and_markdown(tmp_path: Path):
    t = Transcript(sample())
    paths = t.write_chunks(tmp_path / "chunks", 5, "Title")
    assert len(paths) == 4 and paths[0].read_text().startswith("# Title: chunk 1")
    md = t.to_markdown("Title")
    assert "[00:01:40] S2 (seg-0001): line 1" in md


def test_window_and_stats():
    t = Transcript(sample())
    assert [s["id"] for s in t.window(90, 210)] == ["seg-0001", "seg-0002"]
    stats = t.speaker_stats()
    assert {s["id"] for s in stats} == {"S1", "S2"} and stats[0]["turns"] == 6


def test_apply_attribution_merges_relabels_and_labels():
    t = sample()
    attribution = {
        "speakers": [{"id": "S1", "label": "김민수 (PM)", "confidence": 0.9, "evidence": []}],
        "merges": [{"from": ["S2"], "to": "S1"}],
        "relabels": [{"segmentId": "seg-0000", "from": "S1", "to": "S3"}],
        "notes": "",
    }
    out = apply_attribution(t, attribution)
    assert out["segments"][0]["speaker"] == "S3"
    assert all(s["speaker"] == "S1" for s in out["segments"][1:])
    assert out["segments"][1]["speakerLabel"] == "김민수 (PM)"
    assert out["speakers"][0]["id"] == "S1" and out["attributed"] is True
    assert json.dumps(out)  # serializable


def test_hms():
    assert hms(3661) == "01:01:01"
