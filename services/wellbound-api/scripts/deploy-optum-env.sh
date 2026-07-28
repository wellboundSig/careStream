#!/usr/bin/env bash
# Merge Optum env into wellbound-api (and optionally staging), then push zip.
# Requires: aws login (or credentials) + region us-east-2.
#
# Usage:
#   OPTUM_CLIENT_ID=... OPTUM_CLIENT_SECRET=... OPTUM_ENV=production \
#     ./scripts/deploy-optum-env.sh
#
# Optional:
#   OPTUM_PROVIDER_NPI=########## OPTUM_PROVIDER_NAME='WELLBOUND LLC'
#   ALSO_STAGING=1 OPTUM_STAGING_CLIENT_ID=... OPTUM_STAGING_CLIENT_SECRET=...

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${AWS_REGION:-us-east-2}"
ZIP="$ROOT/dist/wellbound-api.zip"

: "${OPTUM_CLIENT_ID:?set OPTUM_CLIENT_ID}"
: "${OPTUM_CLIENT_SECRET:?set OPTUM_CLIENT_SECRET}"
export OPTUM_ENV="${OPTUM_ENV:-production}"
export OPTUM_PROVIDER_NAME="${OPTUM_PROVIDER_NAME:-WELLBOUND LLC}"
export OPTUM_PROVIDER_NPI="${OPTUM_PROVIDER_NPI:-1518305572}"

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
  local fn="$1" cid="$2" csec="$3" envname="$4"
  OPTUM_FN="$fn" OPTUM_CID="$cid" OPTUM_CSEC="$csec" OPTUM_ENVNAME="$envname" REGION="$REGION" python3 - <<'PY'
import json, subprocess, os
fn = os.environ["OPTUM_FN"]
region = os.environ["REGION"]
cid = os.environ["OPTUM_CID"]
csec = os.environ["OPTUM_CSEC"]
envname = os.environ["OPTUM_ENVNAME"]
npi = os.environ.get("OPTUM_PROVIDER_NPI", "1518305572")
name = os.environ.get("OPTUM_PROVIDER_NAME", "WELLBOUND LLC")
subprocess.check_call(["aws", "lambda", "wait", "function-updated", "--function-name", fn, "--region", region])
raw = subprocess.check_output([
  "aws", "lambda", "get-function-configuration",
  "--function-name", fn, "--region", region,
  "--query", "Environment.Variables", "--output", "json",
], text=True)
vars = json.loads(raw) or {}
vars.update({
  "OPTUM_CLIENT_ID": cid,
  "OPTUM_CLIENT_SECRET": csec,
  "OPTUM_ENV": envname,
  "OPTUM_PROVIDER_NPI": npi,
  "OPTUM_PROVIDER_NAME": name,
})
subprocess.check_call([
  "aws", "lambda", "update-function-configuration",
  "--function-name", fn, "--region", region,
  "--environment", json.dumps({"Variables": vars}),
])
print(f"Updated env on {fn} (OPTUM_ENV={envname})")
PY
}

merge_env wellbound-api "$OPTUM_CLIENT_ID" "$OPTUM_CLIENT_SECRET" "$OPTUM_ENV"

if [[ "${ALSO_STAGING:-}" == "1" ]]; then
  SCID="${OPTUM_STAGING_CLIENT_ID:-$OPTUM_CLIENT_ID}"
  SSEC="${OPTUM_STAGING_CLIENT_SECRET:-$OPTUM_CLIENT_SECRET}"
  SENV="${OPTUM_STAGING_ENV:-sandbox}"
  aws lambda update-function-code \
    --function-name wellbound-api-staging \
    --zip-file "fileb://$ZIP" \
    --region "$REGION" >/dev/null
  merge_env wellbound-api-staging "$SCID" "$SSEC" "$SENV"
fi

echo "Done."
