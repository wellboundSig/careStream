-- 0003_routed_to_idtech.sql — stamp when staff escalates an in-house ticket to ID Tech.
-- Once set, Support treats the ticket like a native ID Tech ticket (Managed by ID Tech UI,
-- no "Route to ID Tech" button, reply emails skip the team inbox).

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "routed_to_idtech_at" timestamptz;
