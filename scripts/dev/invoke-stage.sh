#!/usr/bin/env bash
# Invoke ONE agent stage directly on the AgentCore runtime (no Step Functions), for integration testing.
# Usage: scripts/dev/invoke-stage.sh <meetingId> <stage> [ownerSub] [outputLanguage]
# Requires: ${STACK_PREFIX:-MeetingAnalyzer}-Agent deployed, transcript at s3://$DATA_BUCKET/transcripts/<meetingId>/transcript.json
set -euo pipefail
MEETING_ID="${1:?meetingId}"; STAGE="${2:?stage}"; OWNER="${3:-dev-user}"; LANG_OUT="${4:-ko}"
REGION="${AWS_REGION:-us-east-1}"
RUNTIME_ARN="${AGENT_RUNTIME_ARN:-$(aws cloudformation describe-stacks --stack-name ${STACK_PREFIX:-MeetingAnalyzer}-Agent --region "$REGION" --query "Stacks[0].Outputs[?OutputKey=='RuntimeArn'].OutputValue" --output text)}"
SESSION="dev-${MEETING_ID}-${STAGE}-$(date +%s)-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
TITLE="${TITLE:-샘플 주간회의}"
PAYLOAD=$(python3 -c 'import json,sys; s,m,o,l,t=sys.argv[1:6]; print(json.dumps({"stage":s,"meetingId":m,"ownerSub":o,"title":t,"outputLanguage":l,"transcriptKey":f"transcripts/{m}/transcript.json"}, ensure_ascii=False))' "$STAGE" "$MEETING_ID" "$OWNER" "$LANG_OUT" "$TITLE")
echo "invoking $STAGE for $MEETING_ID (session $SESSION)"
aws bedrock-agentcore invoke-agent-runtime --region "$REGION" --agent-runtime-arn "$RUNTIME_ARN" --runtime-session-id "$SESSION" \
  --content-type application/json --accept application/json --payload "$(echo -n "$PAYLOAD" | base64 -w0)" /tmp/invoke-out.json >/dev/null
cat /tmp/invoke-out.json; echo
echo "result will appear at s3://\$DATA_BUCKET/results/$MEETING_ID/$STAGE.json; poll with:"
echo "  aws s3 ls s3://<bucket>/results/$MEETING_ID/"
