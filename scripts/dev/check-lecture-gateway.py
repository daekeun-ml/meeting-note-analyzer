#!/usr/bin/env python3
"""Run after deployment: verify WebSearch using the lecture runtime's IAM role.

Default: discovery only, no search/model call. --search also runs one fixed,
non-sensitive query to exercise the Gateway service role and connector.
"""
import argparse
import json
import uuid
import boto3
from botocore.config import Config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stack", default="MeetingAnalyzer-Lecture")
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--search", action="store_true", help="Also execute one WebSearch query (no LLM invocation)")
    args = parser.parse_args()
    session = boto3.Session(region_name=args.region)
    stack = session.client("cloudformation").describe_stacks(StackName=args.stack)["Stacks"][0]
    outputs = {o["OutputKey"]: o["OutputValue"] for o in stack["Outputs"]}
    payload = {"action": "check_search"}
    if args.search:
        payload["query"] = "gradient descent optimization research paper"
    response = session.client("bedrock-agentcore", config=Config(read_timeout=180, retries={"total_max_attempts": 1})).invoke_agent_runtime(
        agentRuntimeArn=outputs["RuntimeArn"], runtimeSessionId=f"lecture-gateway-check-{uuid.uuid4()}", qualifier="DEFAULT",
        contentType="application/json", accept="application/json", payload=json.dumps(payload).encode())
    result = json.loads(response["response"].read())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result.get("status") != "ready":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
