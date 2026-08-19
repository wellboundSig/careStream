#!/usr/bin/env bash
# Deploy with plain AWS CLI (no SAM / no Homebrew required).
set -euo pipefail
cd "$(dirname "$0")"

if [[ ! -f .deploy-secrets.env ]]; then
  echo "Missing .deploy-secrets.env"
  exit 1
fi
# shellcheck disable=SC1091
source .deploy-secrets.env

REGION="${AWS_REGION:-us-east-2}"
STACK="${STACK_NAME:-wellbound-hchb-dup-bridge}"

if ! aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1; then
  echo ""
  echo "AWS session expired. In Terminal run:"
  echo "  aws login"
  echo "Finish the browser login, then run this script again:"
  echo "  ./tools/hchb-dup-bridge/deploy.sh"
  echo ""
  exit 2
fi

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="wellbound-hchb-dup-deploy-${ACCOUNT}-${REGION}"
KEY="hchb-dup-bridge/lambda.zip"

echo "Account=$ACCOUNT Region=$REGION Stack=$STACK"

if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "Creating deploy bucket s3://$BUCKET"
  if [[ "$REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration LocationConstraint="$REGION"
  fi
fi

echo "Packaging Lambda code…"
rm -rf build
mkdir -p build
cp src/app.py build/
# boto3 is in the Lambda runtime — no deps zip needed
( cd build && zip -q lambda.zip app.py )
aws s3 cp build/lambda.zip "s3://${BUCKET}/${KEY}"

echo "Deploying CloudFormation stack…"
aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "$STACK" \
  --template-file template.cf.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    "AgentToken=${AGENT_TOKEN}" \
    "CareStreamToken=${CARESTREAM_TOKEN}" \
    "CodeS3Bucket=${BUCKET}" \
    "CodeS3Key=${KEY}"

# CloudFormation skips updates when the S3 key is unchanged. Always push the
# new zip onto the four Lambdas so code changes actually go live.
echo "Updating Lambda function code…"
FNS=$(aws cloudformation list-stack-resources \
  --stack-name "$STACK" \
  --region "$REGION" \
  --query "StackResourceSummaries[?ResourceType=='AWS::Lambda::Function'].PhysicalResourceId" \
  --output text)
for fn in $FNS; do
  aws lambda update-function-code \
    --function-name "$fn" \
    --s3-bucket "$BUCKET" \
    --s3-key "$KEY" \
    --region "$REGION" >/dev/null
  aws lambda wait function-updated --function-name "$fn" --region "$REGION"
  echo "  updated $fn"
done

API_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiBaseUrl'].OutputValue" \
  --output text)

echo ""
echo "========================================"
echo "DEPLOY OK"
echo "ApiBaseUrl=$API_URL"
echo "========================================"

AGENT_ENV="../hchb-dup-agent/.env"
if [[ -f "$AGENT_ENV" ]]; then
  if grep -q '^HCHB_DUP_BRIDGE_URL=' "$AGENT_ENV"; then
    sed -i '' "s|^HCHB_DUP_BRIDGE_URL=.*|HCHB_DUP_BRIDGE_URL=${API_URL}|" "$AGENT_ENV"
  else
    echo "HCHB_DUP_BRIDGE_URL=${API_URL}" >> "$AGENT_ENV"
  fi
  echo "Updated $AGENT_ENV"
fi

# HTTP API Gateway v2 uses a slightly different event shape than REST.
# Patch app.py helpers are compatible with both if we normalize — already using
# event.get('body') / pathParameters which work for REST; for HTTP API v2
# pathParameters still exist. Good.

echo ""
echo "NEXT: copy tools/hchb-dup-agent (including .env) to the closet Windows PC."
echo "See tools/START_HERE.txt Step 2."