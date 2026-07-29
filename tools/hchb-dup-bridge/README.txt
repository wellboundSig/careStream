AWS bridge for HCHB duplicate checks
====================================

Deploy (from a machine with AWS SAM CLI + credentials in the BAA account):

  cd tools/hchb-dup-bridge
  sam build
  sam deploy --guided

Parameters:
  AgentToken       — closet PC puts this in HCHB_DUP_AGENT_TOKEN
  CareStreamToken  — save for the future CareStream backend wiring

Outputs:
  ApiBaseUrl → closet .env HCHB_DUP_BRIDGE_URL

Test create job (hashes only — 64-char hex):

  curl -s -X POST "$API/jobs" \
    -H "Authorization: Bearer $CARESTREAM_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"hmac_mrn":"<64hex>","hmac_name_dob":"<64hex>"}'

  curl -s "$API/jobs/<job_id>" -H "Authorization: Bearer $CARESTREAM_TOKEN"

Agent endpoints (closet PC uses these automatically):
  POST /agent/claim
  POST /agent/result