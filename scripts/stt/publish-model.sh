#!/usr/bin/env bash
# Triggers the CodeBuild model publisher and waits. Usage: scripts/stt/publish-model.sh [large|large_pro|turbo|...]
# Prereqs: SttStack deployed, HF token stored via npm run secrets, pyannote terms accepted on HF.
set -euo pipefail
VARIANT="${1:-large}"
REGION="${AWS_REGION:-us-east-1}"
PROJECT="${STT_PUBLISHER_PROJECT:-meeting-analyzer-stt-model-publisher}"
BUILD_ID=$(aws codebuild start-build --project-name "$PROJECT" --region "$REGION" \
  --environment-variables-override name=MODEL_VARIANT,value="$VARIANT",type=PLAINTEXT \
  --query 'build.id' --output text)
echo "started $BUILD_ID (variant=$VARIANT)"
while true; do
  STATUS=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --region "$REGION" --query 'builds[0].buildStatus' --output text)
  PHASE=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --region "$REGION" --query 'builds[0].currentPhase' --output text)
  echo "$(date +%H:%M:%S) $STATUS / $PHASE"
  case "$STATUS" in
    SUCCEEDED) echo "model published for variant=$VARIANT"; exit 0 ;;
    FAILED|FAULT|STOPPED|TIMED_OUT) echo "build $STATUS"; aws codebuild batch-get-builds --ids "$BUILD_ID" --region "$REGION" --query 'builds[0].logs.deepLink' --output text; exit 1 ;;
  esac
  sleep 30
done
