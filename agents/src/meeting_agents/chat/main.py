"""AgentCore Runtime entrypoint for the chat agent: streams UI events as SSE, with keep-alives while tools run."""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import uuid
from pathlib import Path

from bedrock_agentcore.runtime import BedrockAgentCoreApp
from pydantic import ValidationError

from .. import tracing
from .agent import run_turn
from .config import KEEPALIVE_SEC
from .payload import ChatPayload

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("chat.main")

app = BedrockAgentCoreApp()
tracing.install()
WORK_ROOT = Path(os.environ.get("WORK_ROOT", str(Path.home() / "work")))


@app.entrypoint
async def invoke(payload: dict, context=None):
    try:
        req = ChatPayload.model_validate(payload)
    except ValidationError as exc:
        yield {"type": "error", "message": f"invalid payload: {str(exc)[:500]}"}
        return
    workdir = WORK_ROOT / "chat" / req.sessionId / uuid.uuid4().hex[:8]
    workdir.mkdir(parents=True, exist_ok=True)
    tracing.CURRENT.set(tracing.StageTrace(stage="chat", meeting_id=req.meetingId or "-", user_id=req.sub, model="sonnet"))
    queue: asyncio.Queue = asyncio.Queue()
    done = object()

    async def produce() -> None:
        try:
            async for ev in run_turn(req, workdir):
                await queue.put(ev)
        except Exception as exc:  # noqa: BLE001
            log.exception("chat turn failed")
            await queue.put({"type": "error", "message": f"처리 중 오류: {str(exc)[:300]}"})
        finally:
            await queue.put(done)

    task = asyncio.create_task(produce())
    try:
        while True:
            try:
                ev = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_SEC)
            except asyncio.TimeoutError:
                yield {"type": "keepalive"}
                continue
            if ev is done:
                break
            yield ev
    finally:
        task.cancel()
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    app.run()
