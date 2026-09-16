-- 0037_asset_management.sql
-- IT Asset + Access Management (Support "/user-solutions" workspace).
--
-- People (asset_mgt_users) are informational staff records, deliberately
-- SEPARATE from the CareStream `users` login table. Assignments connect a
-- person to a solution (software) or a hardware type, with granted/revoked
-- (or assigned/returned) dates. Assignments are NEVER deleted on removal —
-- the revoked/returned date is set instead, preserving full history for
-- point-in-time reporting.
--
-- Onboarding requests capture what a hiring manager asked for (REQUESTED),
-- which is distinct from what IT actually handed out (an assignment row).
--
-- Catalog seeds (organizations, categories, solutions, hardware types,
-- presets) live at the bottom. People seeds are in 0038 (generated).

-- ── asset_mgt_organizations ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "asset_mgt_organizations" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "name" text NOT NULL,
  "active" boolean DEFAULT TRUE,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_organizations_id" ON "asset_mgt_organizations" ("id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_organizations_updated_at" ON "asset_mgt_organizations" ("updated_at");
DROP TRIGGER IF EXISTS "trg_asset_mgt_organizations_touch" ON "asset_mgt_organizations";
CREATE TRIGGER "trg_asset_mgt_organizations_touch" BEFORE UPDATE ON "asset_mgt_organizations" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── asset_mgt_solution_categories ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "asset_mgt_solution_categories" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "name" text NOT NULL,
  "sort_order" bigint,
  "active" boolean DEFAULT TRUE,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_solution_categories_id" ON "asset_mgt_solution_categories" ("id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_solution_categories_updated_at" ON "asset_mgt_solution_categories" ("updated_at");
DROP TRIGGER IF EXISTS "trg_asset_mgt_solution_categories_touch" ON "asset_mgt_solution_categories";
CREATE TRIGGER "trg_asset_mgt_solution_categories_touch" BEFORE UPDATE ON "asset_mgt_solution_categories" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── asset_mgt_solutions ────────────────────────────────────────────────────
-- solution_class: MANAGED_SYSTEM | SHARED_UTILITY | PUBLIC_RESOURCE
-- requestable:    shown on the hiring-manager request form
-- request_rank:   ordering on the request form (lower = higher on the list)
CREATE TABLE IF NOT EXISTS "asset_mgt_solutions" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "name" text NOT NULL,
  "category_id" text,
  "solution_class" text DEFAULT 'MANAGED_SYSTEM',
  "active" boolean DEFAULT TRUE,
  "requestable" boolean DEFAULT TRUE,
  "request_rank" bigint DEFAULT 100,
  "notes" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_solutions_id" ON "asset_mgt_solutions" ("id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_solutions_category_id" ON "asset_mgt_solutions" ("category_id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_solutions_updated_at" ON "asset_mgt_solutions" ("updated_at");
DROP TRIGGER IF EXISTS "trg_asset_mgt_solutions_touch" ON "asset_mgt_solutions";
CREATE TRIGGER "trg_asset_mgt_solutions_touch" BEFORE UPDATE ON "asset_mgt_solutions" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── asset_mgt_solution_organizations (solution ↔ org, "Used By") ───────────
CREATE TABLE IF NOT EXISTS "asset_mgt_solution_organizations" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "solution_id" text NOT NULL,
  "organization_id" text NOT NULL,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "asset_mgt_solution_orgs_uidx" ON "asset_mgt_solution_organizations" ("solution_id", "organization_id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_solution_organizations_solution_id" ON "asset_mgt_solution_organizations" ("solution_id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_solution_organizations_organization_id" ON "asset_mgt_solution_organizations" ("organization_id");
DROP TRIGGER IF EXISTS "trg_asset_mgt_solution_organizations_touch" ON "asset_mgt_solution_organizations";
CREATE TRIGGER "trg_asset_mgt_solution_organizations_touch" BEFORE UPDATE ON "asset_mgt_solution_organizations" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── asset_mgt_users (informational staff records — NOT CareStream logins) ──
-- staff_type: FIELD | OFFICE.  status: Active | Inactive.
CREATE TABLE IF NOT EXISTS "asset_mgt_users" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "employee_id" text,
  "first_name" text,
  "last_name" text,
  "name" text NOT NULL,
  "staff_type" text NOT NULL DEFAULT 'OFFICE',
  "discipline" text,
  "title" text,
  "email" text,
  "status" text NOT NULL DEFAULT 'Active',
  "hire_date" date,
  "termination_date" date,
  "source" text DEFAULT 'MANUAL',
  "notes" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_users_id" ON "asset_mgt_users" ("id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_users_employee_id" ON "asset_mgt_users" ("employee_id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_users_updated_at" ON "asset_mgt_users" ("updated_at");
DROP TRIGGER IF EXISTS "trg_asset_mgt_users_touch" ON "asset_mgt_users";
CREATE TRIGGER "trg_asset_mgt_users_touch" BEFORE UPDATE ON "asset_mgt_users" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── asset_mgt_user_solutions (assignment history — never hard-deleted) ─────
-- relationship_type: ACCESS | PROFILE.  Current = revoked_date IS NULL.
CREATE TABLE IF NOT EXISTS "asset_mgt_user_solutions" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "user_id" text NOT NULL,
  "solution_id" text NOT NULL,
  "relationship_type" text DEFAULT 'ACCESS',
  "granted_date" date,
  "revoked_date" date,
  "granted_by_id" text,
  "revoked_by_id" text,
  "notes" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_user_solutions_user_id" ON "asset_mgt_user_solutions" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_user_solutions_solution_id" ON "asset_mgt_user_solutions" ("solution_id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_user_solutions_updated_at" ON "asset_mgt_user_solutions" ("updated_at");
DROP TRIGGER IF EXISTS "trg_asset_mgt_user_solutions_touch" ON "asset_mgt_user_solutions";
CREATE TRIGGER "trg_asset_mgt_user_solutions_touch" BEFORE UPDATE ON "asset_mgt_user_solutions" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── asset_mgt_hardware_types ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "asset_mgt_hardware_types" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "name" text NOT NULL,
  "active" boolean DEFAULT TRUE,
  "supports_quantity" boolean DEFAULT FALSE,
  "allow_details" boolean DEFAULT FALSE,
  "sort_order" bigint,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_hardware_types_id" ON "asset_mgt_hardware_types" ("id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_hardware_types_updated_at" ON "asset_mgt_hardware_types" ("updated_at");
DROP TRIGGER IF EXISTS "trg_asset_mgt_hardware_types_touch" ON "asset_mgt_hardware_types";
CREATE TRIGGER "trg_asset_mgt_hardware_types_touch" BEFORE UPDATE ON "asset_mgt_hardware_types" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── asset_mgt_user_hardware (equipment history — never hard-deleted) ───────
-- Current = returned_date IS NULL.  details is only used for "Other".
CREATE TABLE IF NOT EXISTS "asset_mgt_user_hardware" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "user_id" text NOT NULL,
  "hardware_type_id" text NOT NULL,
  "quantity" bigint DEFAULT 1,
  "details" text,
  "assigned_date" date,
  "returned_date" date,
  "assigned_by_id" text,
  "returned_by_id" text,
  "notes" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_user_hardware_user_id" ON "asset_mgt_user_hardware" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_user_hardware_hardware_type_id" ON "asset_mgt_user_hardware" ("hardware_type_id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_user_hardware_updated_at" ON "asset_mgt_user_hardware" ("updated_at");
DROP TRIGGER IF EXISTS "trg_asset_mgt_user_hardware_touch" ON "asset_mgt_user_hardware";
CREATE TRIGGER "trg_asset_mgt_user_hardware_touch" BEFORE UPDATE ON "asset_mgt_user_hardware" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── asset_mgt_presets (bundles applied at onboarding/request time) ─────────
CREATE TABLE IF NOT EXISTS "asset_mgt_presets" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "name" text NOT NULL,
  "staff_type" text,
  "description" text,
  "active" boolean DEFAULT TRUE,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_presets_id" ON "asset_mgt_presets" ("id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_presets_updated_at" ON "asset_mgt_presets" ("updated_at");
DROP TRIGGER IF EXISTS "trg_asset_mgt_presets_touch" ON "asset_mgt_presets";
CREATE TRIGGER "trg_asset_mgt_presets_touch" BEFORE UPDATE ON "asset_mgt_presets" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── asset_mgt_preset_items ─────────────────────────────────────────────────
-- item_type: SOLUTION | HARDWARE
CREATE TABLE IF NOT EXISTS "asset_mgt_preset_items" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "preset_id" text NOT NULL,
  "item_type" text NOT NULL,
  "solution_id" text,
  "relationship_type" text,
  "hardware_type_id" text,
  "quantity" bigint DEFAULT 1,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_preset_items_preset_id" ON "asset_mgt_preset_items" ("preset_id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_preset_items_updated_at" ON "asset_mgt_preset_items" ("updated_at");
DROP TRIGGER IF EXISTS "trg_asset_mgt_preset_items_touch" ON "asset_mgt_preset_items";
CREATE TRIGGER "trg_asset_mgt_preset_items_touch" BEFORE UPDATE ON "asset_mgt_preset_items" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── asset_mgt_onboarding_requests ──────────────────────────────────────────
-- One per new hire. token backs the unique manager link
-- (/onboarding-request/<token>). status: PENDING | SUBMITTED | COMPLETED |
-- CANCELLED. ticket_id references Tickets.rec_id once submitted.
CREATE TABLE IF NOT EXISTS "asset_mgt_onboarding_requests" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "token" text NOT NULL,
  "new_hire_first_name" text,
  "new_hire_last_name" text,
  "new_hire_name" text NOT NULL,
  "new_hire_title" text,
  "staff_type" text,
  "entity" text,
  "start_date" date,
  "hiring_manager_name" text,
  "hiring_manager_email" text,
  "status" text NOT NULL DEFAULT 'PENDING',
  "asset_user_id" text,
  "ticket_id" text,
  "source_entry_id" text,
  "submitted_at" timestamptz,
  "submitted_by_id" text,
  "completed_at" timestamptz,
  "completed_by_id" text,
  "notes" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "asset_mgt_onboarding_requests_token_uidx" ON "asset_mgt_onboarding_requests" ("token");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_onboarding_requests_asset_user_id" ON "asset_mgt_onboarding_requests" ("asset_user_id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_onboarding_requests_updated_at" ON "asset_mgt_onboarding_requests" ("updated_at");
DROP TRIGGER IF EXISTS "trg_asset_mgt_onboarding_requests_touch" ON "asset_mgt_onboarding_requests";
CREATE TRIGGER "trg_asset_mgt_onboarding_requests_touch" BEFORE UPDATE ON "asset_mgt_onboarding_requests" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── asset_mgt_onboarding_request_items ─────────────────────────────────────
-- What the manager asked for. REQUESTED is not ASSIGNED — IT fulfills each
-- item, which creates the real assignment row. status: REQUESTED | FULFILLED
-- | DECLINED.
CREATE TABLE IF NOT EXISTS "asset_mgt_onboarding_request_items" (
  "rec_id" text PRIMARY KEY DEFAULT gen_rec_id(),
  "id" text,
  "request_id" text NOT NULL,
  "item_type" text NOT NULL,
  "solution_id" text,
  "relationship_type" text,
  "hardware_type_id" text,
  "quantity" bigint DEFAULT 1,
  "details" text,
  "status" text NOT NULL DEFAULT 'REQUESTED',
  "fulfilled_at" timestamptz,
  "fulfilled_by_id" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_onboarding_request_items_request_id" ON "asset_mgt_onboarding_request_items" ("request_id");
CREATE INDEX IF NOT EXISTS "idx_asset_mgt_onboarding_request_items_updated_at" ON "asset_mgt_onboarding_request_items" ("updated_at");
DROP TRIGGER IF EXISTS "trg_asset_mgt_onboarding_request_items_touch" ON "asset_mgt_onboarding_request_items";
CREATE TRIGGER "trg_asset_mgt_onboarding_request_items_touch" BEFORE UPDATE ON "asset_mgt_onboarding_request_items" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- CATALOG SEEDS (deterministic rec_ids so re-runs are no-ops)
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO "asset_mgt_organizations" ("rec_id", "id", "name") VALUES
  ('recamorgwellbound', 'recamorgwellbound', 'Wellbound'),
  ('recamorgarista',    'recamorgarista',    'Arista')
ON CONFLICT ("rec_id") DO NOTHING;

INSERT INTO "asset_mgt_solution_categories" ("rec_id", "id", "name", "sort_order") VALUES
  ('recamcat01', 'recamcat01', 'HR / Payroll / Workforce', 10),
  ('recamcat02', 'recamcat02', 'Training / LMS / Compliance', 20),
  ('recamcat03', 'recamcat03', 'Clinical / EMR / Home Health', 30),
  ('recamcat04', 'recamcat04', 'Clinical / Home Care / EVV', 40),
  ('recamcat05', 'recamcat05', 'Clinical / EMR', 50),
  ('recamcat06', 'recamcat06', 'Clinical / Intake / CRM', 60),
  ('recamcat07', 'recamcat07', 'Home Care Automation / AI', 70),
  ('recamcat08', 'recamcat08', 'Healthcare Payer / Eligibility', 80),
  ('recamcat09', 'recamcat09', 'Healthcare Payer / Claims / Eligibility', 90),
  ('recamcat10', 'recamcat10', 'Healthcare Payer / Eligibility / Claims', 100),
  ('recamcat11', 'recamcat11', 'CMS / Regulatory / Quality Reporting', 110),
  ('recamcat12', 'recamcat12', 'Healthcare Analytics / Quality Reporting', 120),
  ('recamcat13', 'recamcat13', 'Productivity / Office', 130),
  ('recamcat14', 'recamcat14', 'Productivity / Project Management', 140),
  ('recamcat15', 'recamcat15', 'Productivity / File Storage', 150),
  ('recamcat16', 'recamcat16', 'Productivity / Scheduling', 160),
  ('recamcat17', 'recamcat17', 'Forms / Data Collection', 170),
  ('recamcat18', 'recamcat18', 'E-Signature / Documents', 180),
  ('recamcat19', 'recamcat19', 'Documents / PDF', 190),
  ('recamcat20', 'recamcat20', 'Creative / Documents', 200),
  ('recamcat21', 'recamcat21', 'Creative / Design', 210),
  ('recamcat22', 'recamcat22', 'Marketing / Email', 220),
  ('recamcat23', 'recamcat23', 'Marketing / Social Media', 230),
  ('recamcat24', 'recamcat24', 'Marketing / Printing', 240),
  ('recamcat25', 'recamcat25', 'Digital Signage', 250),
  ('recamcat26', 'recamcat26', 'IT Infrastructure / Cloud', 260),
  ('recamcat27', 'recamcat27', 'IT Infrastructure / Web / DNS', 270),
  ('recamcat28', 'recamcat28', 'IT Infrastructure / Web Hosting', 280),
  ('recamcat29', 'recamcat29', 'IT Infrastructure / Domains / Hosting', 290),
  ('recamcat30', 'recamcat30', 'IT Infrastructure / Authentication', 300),
  ('recamcat31', 'recamcat31', 'Communications / Email Infrastructure', 310),
  ('recamcat32', 'recamcat32', 'Communications / SMS / Voice', 320),
  ('recamcat33', 'recamcat33', 'Communications / Fax', 330),
  ('recamcat34', 'recamcat34', 'Communications / Phone Numbers', 340),
  ('recamcat35', 'recamcat35', 'Communications / Telecom', 350),
  ('recamcat36', 'recamcat36', 'IT Support / Remote Access', 360),
  ('recamcat37', 'recamcat37', 'IT Tools / Android Virtualization', 370),
  ('recamcat38', 'recamcat38', 'CRM', 380),
  ('recamcat39', 'recamcat39', 'Physical Security / Access Control', 390),
  ('recamcat40', 'recamcat40', 'Purchasing', 400),
  ('recamcat41', 'recamcat41', 'ACF Training', 410),
  ('recamcat42', 'recamcat42', 'Version Management and Code', 420),
  ('recamcat43', 'recamcat43', 'Documents and SQL library', 430),
  ('recamcat44', 'recamcat44', 'Visit and Tracking', 440),
  ('recamcat45', 'recamcat45', 'Softphone / PBX', 450),
  ('recamcat46', 'recamcat46', 'Procurement / Office Supplies', 460)
ON CONFLICT ("rec_id") DO NOTHING;

-- Solutions. request_rank drives the hiring-manager form ordering:
--   1-8   most common (HCHB, HHAeXchange, ePaces, Pointcare, BoldSign,
--         Jotform, CareStream, Dataphone)
--   10-17 second tier (ARLA, Availity, Optum, eSolutions, iQIES, Waystar,
--         Io Health, ProviderLink)
--   100   everything else (alphabetical in the UI)
-- Empeon and Business 365 are requestable = FALSE: by the time the manager
-- form goes out, the hire is already onboarded into Empeon and Microsoft 365.
INSERT INTO "asset_mgt_solutions"
  ("rec_id", "id", "name", "category_id", "solution_class", "requestable", "request_rank") VALUES
  ('recamsolhchb',        'recamsolhchb',        'Homecare Homebase',   'recamcat03', 'MANAGED_SYSTEM', TRUE,  1),
  ('recamsolhhaex',       'recamsolhhaex',       'HHAeXchange',         'recamcat04', 'MANAGED_SYSTEM', TRUE,  2),
  ('recamsolepaces',      'recamsolepaces',      'ePaces',              NULL,         'MANAGED_SYSTEM', TRUE,  3),
  ('recamsolpointcare',   'recamsolpointcare',   'Pointcare',           'recamcat44', 'MANAGED_SYSTEM', TRUE,  4),
  ('recamsolboldsign',    'recamsolboldsign',    'BoldSign',            'recamcat18', 'MANAGED_SYSTEM', TRUE,  5),
  ('recamsoljotform',     'recamsoljotform',     'Jotform',             'recamcat17', 'MANAGED_SYSTEM', TRUE,  6),
  ('recamsolcarestream',  'recamsolcarestream',  'CareStream',          'recamcat06', 'MANAGED_SYSTEM', TRUE,  7),
  ('recamsoldataphone',   'recamsoldataphone',   'Dataphone',           'recamcat45', 'MANAGED_SYSTEM', TRUE,  8),
  ('recamsolarla',        'recamsolarla',        'ARLA',                'recamcat07', 'MANAGED_SYSTEM', TRUE, 10),
  ('recamsolavaility',    'recamsolavaility',    'Availity',            'recamcat08', 'MANAGED_SYSTEM', TRUE, 11),
  ('recamsoloptum',       'recamsoloptum',       'Optum',               'recamcat09', 'MANAGED_SYSTEM', TRUE, 12),
  ('recamsolesolutions',  'recamsolesolutions',  'eSolutions',          'recamcat10', 'MANAGED_SYSTEM', TRUE, 13),
  ('recamsoliqies',       'recamsoliqies',       'iQIES',               'recamcat11', 'MANAGED_SYSTEM', TRUE, 14),
  ('recamsolwaystar',     'recamsolwaystar',     'Waystar',             NULL,         'MANAGED_SYSTEM', TRUE, 15),
  ('recamsoliohealth',    'recamsoliohealth',    'Io Health',           NULL,         'MANAGED_SYSTEM', TRUE, 16),
  ('recamsolproviderlink','recamsolproviderlink','ProviderLink',        NULL,         'MANAGED_SYSTEM', TRUE, 17),
  ('recamsolempeon',      'recamsolempeon',      'Empeon',              'recamcat01', 'MANAGED_SYSTEM', FALSE, 100),
  ('recamsolviventium',   'recamsolviventium',   'Viventium',           'recamcat01', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolshowdme',     'recamsolshowdme',     'Showd.me',            'recamcat02', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolnetsmart',    'recamsolnetsmart',    'Netsmart',            'recamcat05', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolshpdata',     'recamsolshpdata',     'SHP Data',            'recamcat12', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolbusiness365', 'recamsolbusiness365', 'Business 365',        'recamcat13', 'MANAGED_SYSTEM', FALSE, 100),
  ('recamsolmonday',      'recamsolmonday',      'Monday.com',          'recamcat14', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsoldropbox',     'recamsoldropbox',     'Dropbox',             'recamcat15', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolappointlet',  'recamsolappointlet',  'Appointlet',          'recamcat16', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolwufoo',       'recamsolwufoo',       'Wufoo Forms',         'recamcat17', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolpdfxchange',  'recamsolpdfxchange',  'PDF-XChange',         'recamcat19', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsoladobe',       'recamsoladobe',       'Adobe',               'recamcat20', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolcanva',       'recamsolcanva',       'Canva',               'recamcat21', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolmailchimp',   'recamsolmailchimp',   'Mailchimp',           'recamcat22', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolhootsuite',   'recamsolhootsuite',   'Hootsuite',           'recamcat23', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolvistaprint',  'recamsolvistaprint',  'VistaPrint',          'recamcat24', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolsmartsign',   'recamsolsmartsign',   'SmartSign2Go',        'recamcat25', 'SHARED_UTILITY', TRUE, 100),
  ('recamsolaws',         'recamsolaws',         'AWS',                 'recamcat26', 'SHARED_UTILITY', TRUE, 100),
  ('recamsolcloudflare',  'recamsolcloudflare',  'Cloudflare',          'recamcat27', 'SHARED_UTILITY', TRUE, 100),
  ('recamsolsiteground',  'recamsolsiteground',  'SiteGround',          'recamcat28', 'SHARED_UTILITY', TRUE, 100),
  ('recamsolgodaddy',     'recamsolgodaddy',     'GoDaddy',             'recamcat29', 'SHARED_UTILITY', TRUE, 100),
  ('recamsolclerkauth',   'recamsolclerkauth',   'Clerk Auth',          'recamcat30', 'SHARED_UTILITY', TRUE, 100),
  ('recamsolsmtp2go',     'recamsolsmtp2go',     'SMTP2GO',             'recamcat31', 'SHARED_UTILITY', TRUE, 100),
  ('recamsoltwilio',      'recamsoltwilio',      'Twilio',              'recamcat32', 'SHARED_UTILITY', TRUE, 100),
  ('recamsolfaxage',      'recamsolfaxage',      'FAXAGE',              'recamcat33', 'SHARED_UTILITY', TRUE, 100),
  ('recamsolnumberbarn',  'recamsolnumberbarn',  'NumberBarn.com',      'recamcat34', 'SHARED_UTILITY', TRUE, 100),
  ('recamsolwindstream',  'recamsolwindstream',  'Windstream',          'recamcat35', 'SHARED_UTILITY', TRUE, 100),
  ('recamsoldynalink',    'recamsoldynalink',    'DynaLink Billcenter', 'recamcat35', 'SHARED_UTILITY', TRUE, 100),
  ('recamsollogmein',     'recamsollogmein',     'LogMeIn',             'recamcat36', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolcitrix',      'recamsolcitrix',      'Citrix Workspace',    'recamcat36', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolbluestacks',  'recamsolbluestacks',  'BlueStacks',          'recamcat37', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolinflocare',   'recamsolinflocare',   'InfloCare',           'recamcat38', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolaxtraxng',    'recamsolaxtraxng',    'AxTraxNG',            'recamcat39', 'SHARED_UTILITY', TRUE, 100),
  ('recamsolamazon',      'recamsolamazon',      'Amazon',              'recamcat40', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolrelias',      'recamsolrelias',      'Relias',              'recamcat41', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolgithub',      'recamsolgithub',      'Github',              'recamcat42', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolnotion',      'recamsolnotion',      'Notion',              'recamcat43', 'MANAGED_SYSTEM', TRUE, 100),
  ('recamsolquill',       'recamsolquill',       'Quill',               'recamcat46', 'MANAGED_SYSTEM', TRUE, 100)
ON CONFLICT ("rec_id") DO NOTHING;

-- Used By (from the solutions sheet: Empeon → Wellbound, Viventium → Arista,
-- Showd.me → Both). Everything else is unassigned until configured.
INSERT INTO "asset_mgt_solution_organizations" ("rec_id", "id", "solution_id", "organization_id") VALUES
  ('recamsolorg001', 'recamsolorg001', 'recamsolempeon',    'recamorgwellbound'),
  ('recamsolorg002', 'recamsolorg002', 'recamsolviventium', 'recamorgarista'),
  ('recamsolorg003', 'recamsolorg003', 'recamsolshowdme',   'recamorgwellbound'),
  ('recamsolorg004', 'recamsolorg004', 'recamsolshowdme',   'recamorgarista')
ON CONFLICT ("rec_id") DO NOTHING;

INSERT INTO "asset_mgt_hardware_types"
  ("rec_id", "id", "name", "supports_quantity", "allow_details", "sort_order") VALUES
  ('recamhwlaptop',  'recamhwlaptop',  'Laptop',         FALSE, FALSE, 10),
  ('recamhwmonitor', 'recamhwmonitor', 'WFH Monitor',    TRUE,  FALSE, 20),
  ('recamhwcharger', 'recamhwcharger', 'Laptop Charger', FALSE, FALSE, 30),
  ('recamhwtablet',  'recamhwtablet',  'Tablet',         FALSE, FALSE, 40),
  ('recamhwother',   'recamhwother',   'Other',          TRUE,  TRUE,  50)
ON CONFLICT ("rec_id") DO NOTHING;

-- Presets. Clinicians: Pointcare access + HCHB administrative profile +
-- tablet. Office: HCHB login profile (ACCESS) + Business 365 + Empeon.
INSERT INTO "asset_mgt_presets" ("rec_id", "id", "name", "staff_type", "description") VALUES
  ('recampresetfield',  'recampresetfield',  'Clinician',       'FIELD',  'Standard field clinician bundle'),
  ('recampresetoffice', 'recampresetoffice', 'Office Employee', 'OFFICE', 'Standard office staff bundle')
ON CONFLICT ("rec_id") DO NOTHING;

INSERT INTO "asset_mgt_preset_items"
  ("rec_id", "id", "preset_id", "item_type", "solution_id", "relationship_type", "hardware_type_id", "quantity") VALUES
  ('recampitem001', 'recampitem001', 'recampresetfield',  'SOLUTION', 'recamsolpointcare',   'ACCESS',  NULL, 1),
  ('recampitem002', 'recampitem002', 'recampresetfield',  'SOLUTION', 'recamsolhchb',        'PROFILE', NULL, 1),
  ('recampitem003', 'recampitem003', 'recampresetfield',  'HARDWARE', NULL, NULL, 'recamhwtablet', 1),
  ('recampitem004', 'recampitem004', 'recampresetoffice', 'SOLUTION', 'recamsolhchb',        'ACCESS',  NULL, 1),
  ('recampitem005', 'recampitem005', 'recampresetoffice', 'SOLUTION', 'recamsolbusiness365', 'ACCESS',  NULL, 1),
  ('recampitem006', 'recampitem006', 'recampresetoffice', 'SOLUTION', 'recamsolempeon',      'ACCESS',  NULL, 1)
ON CONFLICT ("rec_id") DO NOTHING;
