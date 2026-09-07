import os

os.environ["STT_SKIP_MODEL_LOAD"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from stt import server  # noqa: E402
from stt.align import Turn  # noqa: E402
from stt.inference import Engine, build_response  # noqa: E402
from stt.schemas import SttRequest, Word  # noqa: E402
from stt.transcriber import TranscriptionResult  # noqa: E402


class FakeTranscriber:
    name = "fake"

    def transcribe(self, wav, *, language, mode, hotwords):
        return TranscriptionResult(words=[Word(w=" hello", s=0, e=0.5), Word(w=" world", s=0.6, e=1.0)], language="en", language_probability=0.9, text="hello world")


class FakeDiarizer:
    def diarize(self, wav, *, min_speakers=None, max_speakers=None):
        return [Turn(0, 1.0, "SPEAKER_00")]


def test_ping_is_503_until_engine_set():
    server._state["engine"] = None
    server._state["error"] = None
    with TestClient(server.app) as c:
        assert c.get("/ping").status_code == 503


def test_build_response_shape():
    req = SttRequest(meetingId="m1", audio_s3_uri="s3://b/k.mp3")
    resp = build_response(req, FakeTranscriber().transcribe(None, language=None, mode="intended", hotwords=[]).words, "en", 0.9, FakeDiarizer().diarize(None), 1.0, "fake", {})
    assert resp.meetingId == "m1" and resp.language == "en" and resp.durationSec == 1.0
    assert resp.segments[0].speaker == "S1" and resp.segments[0].text == "hello world"
    assert resp.speakers == [type(resp.speakers[0])(id="S1", talkTimeSec=1.0)]


def test_invocations_end_to_end_with_fake_engine(monkeypatch, tmp_path):
    engine = Engine(FakeTranscriber(), FakeDiarizer())
    # bypass S3 + ffmpeg
    monkeypatch.setattr(engine, "_download", lambda uri, dst: dst.write_bytes(b"x"))
    monkeypatch.setattr("stt.inference.probe_duration", lambda p: 1.0)
    monkeypatch.setattr("stt.inference.to_wav16k", lambda src, dst: dst)
    server.set_engine(engine)
    with TestClient(server.app) as c:
        assert c.get("/ping").status_code == 200
        r = c.post("/invocations", json={"meetingId": "m1", "audio_s3_uri": "s3://b/k.mp3"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["version"] == 1 and body["segments"][0]["text"] == "hello world"
        assert body["stats"]["wordCount"] == 2


def test_invocations_rejects_too_long(monkeypatch):
    engine = Engine(FakeTranscriber(), None)
    monkeypatch.setattr(engine, "_download", lambda uri, dst: dst.write_bytes(b"x"))
    monkeypatch.setattr("stt.inference.probe_duration", lambda p: 5 * 3600.0)
    server.set_engine(engine)
    with TestClient(server.app) as c:
        r = c.post("/invocations", json={"meetingId": "m1", "audio_s3_uri": "s3://b/k.mp3"})
        assert r.status_code == 400 and "too long" in r.json()["error"]


def test_ping_answers_while_a_job_is_running():
    """The health check must not wait for the model: SageMaker replaces an instance whose /ping stalls."""
    import asyncio
    import time

    import httpx

    class SlowEngine:
        def process(self, req):
            time.sleep(1.5)  # simulates the GPU job holding a worker thread, not the event loop
            return build_response(req, [Word(w=" hi", s=0, e=0.5)], "en", 0.9, [Turn(0, 0.5, "SPEAKER_00")], 0.5, "fake", {})

    server.set_engine(SlowEngine())

    async def run():
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            job = asyncio.create_task(c.post("/invocations", json={"meetingId": "m1", "audio_s3_uri": "s3://b/k.mp3"}))
            await asyncio.sleep(0.2)
            t0 = time.monotonic()
            ping = await c.get("/ping")
            ping_latency = time.monotonic() - t0
            res = await job
            return ping.status_code, ping_latency, res.status_code

    status, latency, job_status = asyncio.run(run())
    assert status == 200 and job_status == 200
    assert latency < 1.0, f"/ping waited {latency:.2f}s for the running job"
