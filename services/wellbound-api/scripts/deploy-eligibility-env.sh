#!/usr/bin/env bash
# Merge clearinghouse eligibility credentials (Waystar + Availity) into
# wellbound-api's Lambda env, then push the zip. Optum vars are managed by
# deploy-optum-env.sh and are left untouched.
#
# Reads: .deploy-secrets.eligibility.env (gitignored) unless vars already set.
#
# Usage:
#   ./scripts/deploy-eligibility-env.sh
#   ALSO_STAGING=1 ./scripts/deploy-eligibility-env.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-us-east-2}"
ZIP="$ROOT/dist/wellbound-api.zip"
SECRETS_FILE="$ROOT/.deploy-secrets.eligibility.env"

if [[ -f "$SECRETS_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
  set +a
fi

: "${WAYSTAR_API_USERID:?set WAYSTAR_API_USERID (or fill .deploy-secrets.eligibility.env)}"
: "${WAYSTAR_API_PASSWORD:?set WAYSTAR_API_PASSWORD}"
: "${AVAILITY_CLIENT_ID:?set AVAILITY_CLIENT_ID}"
: "${AVAILITY_CLIENT_SECRET:?set AVAILITY_CLIENT_SECRET (from the Availity portal — key alone is not enough)}"
export AVAILITY_ENV="${AVAILITY_ENV:-production}"
export WAYSTAR_GATEWAY_URL="${WAYSTAR_GATEWAY_URL:-https://eligibilityapi.zirmed.com/1.0/Rest/Gateway/GatewayAsync.ashx}"

if [[ ! -f "$ZIP" ]]; then
  echo "Building zip…"
  (cd "$ROOT" && node build.js)
fi

echo "Updating function code…"
aws lambda update-function-code \
  --function-name wellbound-api \
  --zip-file "fileb://$ZIP" \
  --region "$REGION" >/dev/null

merge_env() {
  local fn="$1"
  FN="$fn" REGION="$REGION" python3 - <<'PY'
import json, subprocess, os
fn = os.environ["FN"]
region = os.environ["REGION"]
subprocess.check_call(["aws", "lambda", "wait", "function-updated", "--function-name", fn, "--region", region])
raw = subprocess.check_output([
  "aws", "lambda", "get-function-configuration",
  "--function-name", fn, "--region", region,
  "--query", "Environment.Variables", "--output", "json",
], text=True)
vars = json.loads(raw) or {}
for key in [
  "WAYSTAR_API_USERID", "WAYSTAR_API_PASSWORD", "WAYSTAR_GATEWAY_URL",
  "WAYSTAR_PAYLOAD_FIELD", "WAYSTAR_SENDER_ID",
  "AVAILITY_CLIENT_ID", "AVAILITY_CLIENT_SECRET", "AVAILITY_ENV",
]:
  val = os.environ.get(key)
  if val:
    vars[key] = val
subprocess.check_call([
  "aws", "lambda", "update-function-configuration",
  "--function-name", fn, "--region", region,
  "--environment", json.dumps({"Variables": vars}),
])
print(f"Updated eligibility env on {fn}")
PY
}

merge_env wellbound-api

if [[ "${ALSO_STAGING:-}" == "1" ]]; then
  aws lambda update-function-code \
    --function-name wellbound-api-staging \
    --zip-file "fileb://$ZIP" \
    --region "$REGION" >/dev/null
  merge_env wellbound-api-staging
fi

echo "Done."
