"""AgentCore background task, fenced by a DynamoDB execution lease and Step Functions heartbeat."""
import logging
import tempfile
import threading
from pathlib import Path

import boto3
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from botocore.exceptions import ClientError

from .pipeline import analyze
from .schemas import Request
from .store import Store
from .video import prepare_video
from .search import gateway_check

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)
app = BedrockAgentCoreApp()


def run(request: Request, store: Store, task_id: int):
    sfn = boto3.client("stepfunctions")
    stop, dead = threading.Event(), threading.Event()

    def heartbeat():
        while not stop.wait(120):
            try:
                store.record()
                sfn.send_task_heartbeat(taskToken=request.taskToken)
            except Exception:
                dead.set()
                return

    def check():
        if dead.is_set():
            raise RuntimeError("Lecture task expired")
        store.record()

    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix="lecture-") as tmp:
            result = prepare_video(store, Path(tmp), check) if request.phase == "prepare" else analyze(store, Path(tmp), check)
            if request.phase == "prepare":
                store.update(**result)
        check()
        import json
        sfn.send_task_success(taskToken=request.taskToken, output=json.dumps(result))
    except Exception as exc:
        log.exception("lecture run failed lecture=%s", request.lectureId)
        try:
            sfn.send_task_failure(taskToken=request.taskToken, error="LectureAnalysisFailed", cause=str(exc)[:2000])
        except Exception:
            log.warning("lecture task token already expired")
    finally:
        stop.set()
        thread.join(timeout=2)
        app.complete_async_task(task_id)


@app.entrypoint
def invoke(payload: dict, context=None):
    if payload.get("action") == "check_search":
        # IAM-authenticated operational probe: no lecture data or model invocation.
        try:
            return gateway_check(payload.get("query"))
        except Exception as exc:
            return {"status": "failed", "error": str(exc)[:500]}
    request = Request.model_validate(payload)
    store = Store(request)
    store.record()
    claim = "prepareClaim" if request.phase == "prepare" else "analysisClaim"
    try:
        store.table.update_item(Key=store.key, UpdateExpression="SET #claim = :run",
            ConditionExpression="runId = :run AND #status = :active AND attribute_not_exists(#claim)",
            ExpressionAttributeNames={"#status": "status", "#claim": claim}, ExpressionAttributeValues={":run": request.runId, ":active": request.expected_status})
    except ClientError as exc:
        if exc.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return {"status": "accepted", "duplicate": True}
        raise
    task_id = app.add_async_task(f"lecture:{request.lectureId}")
    threading.Thread(target=run, args=(request, store, task_id), daemon=True).start()
    return {"status": "accepted"}


if __name__ == "__main__":
    app.run()
