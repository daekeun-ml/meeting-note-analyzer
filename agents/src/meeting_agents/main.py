"""AgentCore Runtime entrypoint: accept a stage request, run it in the background, report via Step Functions."""
from __future__ import annotations

import logging
import os
import threading

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from pydantic import ValidationError

from . import tracing
from .payload import StagePayload
from .runner import run_stage

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("agents.main")

app = BedrockAgentCoreApp()
tracing.install()


def _background(payload: StagePayload, task_id: int) -> None:
    try:
        run_stage(payload)
    except Exception:  # noqa: BLE001
        log.exception("stage %s failed", payload.stage)
    finally:
        app.complete_async_task(task_id)


@app.entrypoint
def invoke(payload: dict, context=None) -> dict:
    try:
        req = StagePayload.model_validate(payload)
    except ValidationError as exc:
        log.warning("rejected payload: %s", exc)
        return {"status": "rejected", "error": str(exc)[:2000]}
    task_id = app.add_async_task(f"{req.stage}:{req.meetingId}")
    threading.Thread(target=_background, args=(req, task_id), name=f"stage-{req.stage}", daemon=True).start()
    log.info("accepted stage=%s meeting=%s task=%s", req.stage, req.meetingId, task_id)
    return {"status": "accepted", "stage": req.stage, "meetingId": req.meetingId, "taskId": task_id}


if __name__ == "__main__":
    app.run()
