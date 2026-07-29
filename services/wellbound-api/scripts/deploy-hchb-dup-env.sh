#!/usr/bin/env bash
# Deploy wellbound-api code + merge HCHB dup-check env vars.
# Reads pepper/token/url from tools/hchb-dup-* local env files by default.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$(cd "$ROOT/../../tools" && pwd)"
REGION="${AWS_REGION:-us-east-2}"
FN="${LAMBDA_FUNCTION:-wellbound-api}"
ZIP="$ROOT/dist/wellbound-api.zip"

parse_env() {
  local file="$1" key="$2"
  python3 - "$file" "$key" <<'PY'
import sys
from pathlib import Path
path, key = sys.argv[1], sys.argv[2]
for line in Path(path).read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    if k.strip() == key:
        print(v.strip().strip('"').strip("'"))
        break
PY
}

PEPPER="${HCHB_LINK_PEPPER:-$(parse_env "$TOOLS/hchb-dup-agent/.env" HCHB_LINK_PEPPER)}"
BRIDGE="${HCHB_DUP_BRIDGE_URL:-$(parse_env "$TOOLS/hchb-dup-agent/.env" HCHB_DUP_BRIDGE_URL)}"
TOKEN="${HCHB_DUP_CARESTREAM_TOKEN:-$(parse_env "$TOOLS/hchb-dup-bridge/.deploy-secrets.env" CARESTREAM_TOKEN)}"

: "${PEPPER:?missing HCHB_LINK_PEPPER}"
: "${BRIDGE:?missing HCHB_DUP_BRIDGE_URL}"
: "${TOKEN:?missing HCHB_DUP_CARESTREAM_TOKEN}"

echo "Building zip…"
(cd "$ROOT" && node build.js)

echo "Updating function code on $FN…"
aws lambda update-function-code \
  --function-name "$FN" \
  --zip-file "fileb://$ZIP" \
  --region "$REGION" >/dev/null

aws lambda wait function-updated --function-name "$FN" --region "$REGION"

echo "Merging HCHB env…"
PEPPER="$PEPPER" BRIDGE="$BRIDGE" TOKEN="$TOKEN" FN="$FN" REGION="$REGION" python3 - <<'PY'
import json, os, subprocess
fn = os.environ["FN"]
region = os.environ["REGION"]
raw = subprocess.check_output([
  "aws", "lambda", "get-function-configuration",
  "--function-name", fn, "--region", region,
  "--query", "Environment.Variables", "--output", "json",
], text=True)
vars = json.loads(raw) or {}
vars.update({
  "HCHB_LINK_PEPPER": os.environ["PEPPER"],
  "HCHB_DUP_BRIDGE_URL": os.environ["BRIDGE"].rstrip("/"),
  "HCHB_DUP_CARESTREAM_TOKEN": os.environ["TOKEN"],
})
# Give the dup-check path room to poll the on-prem agent
subprocess.check_call([
  "aws", "lambda", "update-function-configuration",
  "--function-name", fn, "--region", region,
  "--timeout", "30",
  "--environment", json.dumps({"Variables": vars}),
])
print(f"Updated env on {fn}")
print(f"  HCHB_DUP_BRIDGE_URL={os.environ['BRIDGE'].rstrip('/')}")
PY

echo "Done."