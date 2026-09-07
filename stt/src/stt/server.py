"""SageMaker BYOC HTTP contract: GET /ping (200 when ready) and POST /invocations."""
from __future__ import annotations

import logging
import os
import threading
import traceback
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from .inference import Engine
from .schemas import SttRequest

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("stt.server")

MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/opt/ml/model"))
CW_DIR = MODEL_DIR / os.environ.get("CRISPERWHISPER_SUBDIR", "crisperwhisper/ct2")
PYANNOTE_DIR = MODEL_DIR / os.environ.get("PYANNOTE_SUBDIR", "pyannote/community-1")
ENABLE_DIARIZATION = os.environ.get("ENABLE_DIARIZATION", "1") == "1"

app = FastAPI()
_state: dict = {"engine": None, "error": None}
_lock = threading.Lock()


def _load() -> None:
    try:
        from .transcriber import Transcriber

        backend = os.environ.get("STT_BACKEND", "auto")
        log.info("loading CrisperWhisper from %s (backend=%s)", CW_DIR, backend)
        transcriber = Transcriber(CW_DIR if CW_DIR.exists() else os.environ.get("STT_MODEL_ID", "large"), backend=backend)
        diarizer = None
        if ENABLE_DIARIZATION and (PYANNOTE_DIR / "config.yaml").exists():
            from .diarizer import Diarizer

            log.info("loading pyannote from %s", PYANNOTE_DIR)
            diarizer = Diarizer(PYANNOTE_DIR)
        elif ENABLE_DIARIZATION:
            log.warning("pyannote weights not found at %s; diarization disabled (all speech -> S1)", PYANNOTE_DIR)
        _state["engine"] = Engine(transcriber, diarizer)
        log.info("models ready")
    except Exception as exc:  # noqa: BLE001
        _state["error"] = f"{exc}\n{traceback.format_exc()}"
        log.exception("model load failed")


def set_engine(engine: Engine) -> None:
    """Test hook."""
    _state["engine"] = engine


@app.on_event("startup")
def _startup() -> None:
    if _state["engine"] is None and os.environ.get("STT_SKIP_MODEL_LOAD") != "1":
        threading.Thread(target=_load, name="model-loader", daemon=True).start()


@app.get("/ping")
def ping() -> Response:
    if _state["engine"] is not None:
        return Response(status_code=200)
    if _state["error"]:
        return JSONResponse(status_code=500, content={"error": _state["error"][:2000]})
    return Response(status_code=503)


@app.post("/invocations")
async def invocations(request: Request) -> Response:
    engine: Engine | None = _state["engine"]
    if engine is None:
        return JSONResponse(status_code=503, content={"error": "model not loaded"})
    body = await request.json()
    req = SttRequest.model_validate(body)
    log.info("processing meeting=%s uri=%s mode=%s", req.meetingId, req.audio_s3_uri, req.mode)

    def work():
        with _lock:  # one GPU job at a time (MaxConcurrentInvocationsPerInstance=1 on the endpoint side too)
            return engine.process(req)

    # Off the event loop: a long recording keeps the GPU busy for many minutes, and while the loop was blocked
    # /ping went unanswered, so SageMaker declared the instance unhealthy mid-job and replaced it
    # ("server error (0)" on an 86-minute meeting, 2026-09-06). CT2 and torch release the GIL while computing.
    try:
        resp = await run_in_threadpool(work)
    except Exception as exc:  # noqa: BLE001
        log.exception("processing failed")
        return JSONResponse(status_code=400, content={"error": str(exc), "meetingId": req.meetingId})
    log.info("done meeting=%s duration=%.1fs segments=%d stats=%s", req.meetingId, resp.durationSec, len(resp.segments), resp.stats)
    return JSONResponse(status_code=200, content=resp.model_dump())
