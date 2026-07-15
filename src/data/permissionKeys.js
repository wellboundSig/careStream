// ── Permission key constants ─────────────────────────────────────────────────
// Single source of truth for every permission the system recognises.
// Import PERMISSION_KEYS for enforcement checks, PERMISSION_CATALOG for UI
// rendering, and DEFAULT_PRESETS for seeding / preset management.

export const PERMISSION_KEYS = {
  // Division Access
  DIVISION_ALF: 'division.alf',
  DIVISION_SN: 'division.sn',

  // Leads
  LEADS_PROMOTE_TO_INTAKE: 'leads.promote_to_intake',
  LEADS_DISCARD: 'leads.discard',
  INTAKE_EMR_INITIAL: 'intake.emr_initial',

  // Referrals
  REFERRAL_CREATE: 'referral.create',
  REFERRAL_VIEW: 'referral.view',
  REFERRAL_EDIT: 'referral.edit',
  REFERRAL_TRANSITION: 'referral.transition',
  REFERRAL_HOLD: 'referral.hold',
  REFERRAL_NTUC: 'referral.ntuc',
  REFERRAL_NTUC_DIRECT: 'referral.ntuc_direct',
  REFERRAL_FLAG_URGENT_CARE: 'referral.flag_urgent_care',

  // Patients
  PATIENT_VIEW: 'patient.view',
  PATIENT_EDIT: 'patient.edit',

  // Clinical
  CLINICAL_APPROVED_SERVICES: 'clinical.approved_services',
  CLINICAL_TRIAGE: 'clinical.triage',
  CLINICAL_RN_REVIEW: 'clinical.rn_review',
  CLINICAL_F2F: 'clinical.f2f',
  CLINICAL_ELIGIBILITY: 'clinical.eligibility',

  // Authorization
  AUTH_SUBMIT: 'auth.submit',
  AUTH_DECIDE: 'auth.decide',
  AUTH_REQUEST_SCA: 'auth.request_sca',

  // Routing
  ROUTING_OPWDD: 'routing.opwdd',
  ROUTING_DISENROLLMENT_ASSIST: 'routing.disenrollment_assist',

  // OPWDD Enrollment
  OPWDD_CASE_VIEW:            'opwdd.case.view',
  OPWDD_CASE_CREATE:          'opwdd.case.create',
  OPWDD_CASE_EDIT:            'opwdd.case.edit',
  OPWDD_CASE_ASSIGN:          'opwdd.case.assign',
  OPWDD_CHECKLIST_EDIT:       'opwdd.checklist.edit',
  OPWDD_FILE_UPLOAD:          'opwdd.file.upload',
  OPWDD_FILE_VERIFY_CURRENT:  'opwdd.file.verify_current',
  OPWDD_SUBMIT_PACKET:        'opwdd.submit_packet',
  OPWDD_RECORD_NOTICE:        'opwdd.record_notice',
  OPWDD_MARK_CODE95_RECEIVED: 'opwdd.mark_code95_received',
  OPWDD_CONVERT_TO_INTAKE:    'opwdd.convert_to_intake',
  OPWDD_CLOSE_CASE:           'opwdd.close_case',

  // Tasks
  TASK_VIEW: 'task.view',
  TASK_CREATE: 'task.create',
  TASK_ASSIGN: 'task.assign',
  TASK_COMPLETE: 'task.complete',

  // Documents
  FILE_UPLOAD: 'file.upload',
  FILE_UPLOAD_F2F: 'file.upload_f2f',

  // Notes
  NOTE_CREATE: 'note.create',
  NOTE_PIN: 'note.pin',

  // Conflicts
  CONFLICT_FLAG: 'conflict.flag',
  CONFLICT_RESOLVE: 'conflict.resolve',
  CONFLICT_MANAGE_CATEGORIES: 'admin.conflict_categories',

  // Scheduling
  SCHEDULING_STAFFING: 'scheduling.staffing',
  SCHEDULING_ADMIN_CONFIRM: 'scheduling.admin_confirm',
  SCHEDULING_SOC_SCHEDULE: 'scheduling.soc_schedule',
  SCHEDULING_SOC_COMPLETE: 'scheduling.soc_complete',

  // Calendar
  CALENDAR_VIEW: 'calendar.view',

  // Reports
  REPORT_VIEW: 'report.view',
  REPORT_EXPORT: 'report.export',

  // Directory — granular per-page access (view / create / edit each page).
  // Each directory page is independently grantable so a person can be given
  // some directories but not others (e.g. staffing needs Clinicians but not
  // Physicians; intake needs Physicians but not Clinicians).
  DIRECTORY_MARKETERS_VIEW:        'directory.marketers.view',
  DIRECTORY_MARKETERS_CREATE:      'directory.marketers.create',
  DIRECTORY_MARKETERS_EDIT:        'directory.marketers.edit',
  DIRECTORY_FACILITIES_VIEW:       'directory.facilities.view',
  DIRECTORY_FACILITIES_CREATE:     'directory.facilities.create',
  DIRECTORY_FACILITIES_EDIT:       'directory.facilities.edit',
  DIRECTORY_PHYSICIANS_VIEW:       'directory.physicians.view',
  DIRECTORY_PHYSICIANS_CREATE:     'directory.physicians.create',
  DIRECTORY_PHYSICIANS_EDIT:       'directory.physicians.edit',
  DIRECTORY_REFERRAL_SOURCES_VIEW:   'directory.referral_sources.view',
  DIRECTORY_REFERRAL_SOURCES_CREATE: 'directory.referral_sources.create',
  DIRECTORY_REFERRAL_SOURCES_EDIT:   'directory.referral_sources.edit',
  DIRECTORY_CLINICIANS_VIEW:       'directory.clinicians.view',
  DIRECTORY_CLINICIANS_CREATE:     'directory.clinicians.create',
  DIRECTORY_CLINICIANS_EDIT:       'directory.clinicians.edit',
  DIRECTORY_CAMPAIGNS_VIEW:        'directory.campaigns.view',
  DIRECTORY_CAMPAIGNS_CREATE:      'directory.campaigns.create',
  DIRECTORY_CAMPAIGNS_EDIT:        'directory.campaigns.edit',
  FACILITY_EDIT_MARKETERS: 'facility.edit_marketers',

  // Directory — legacy org-wide keys. Retained ONLY for back-compat so older
  // saved permission sets keep working as a fallback; not shown in the catalog.
  // New configuration should use the granular per-page keys above.
  DIRECTORY_VIEW: 'directory.view',
  DIRECTORY_EDIT: 'directory.edit',
  DIRECTORY_CREATE: 'directory.create',

  // Module Visibility (per stage group — controls sidebar and page access)
  MODULE_INTAKE: 'module.intake',
  MODULE_CLINICAL: 'module.clinical',
  MODULE_AUTHORIZATION: 'module.authorization',
  MODULE_SCHEDULING: 'module.scheduling',
  MODULE_ADMIN: 'module.admin',
  MODULE_INBOUND: 'module.inbound',

  // Inbound Submissions (email → ticket queue)
  INBOUND_VIEW: 'inbound.view',
  INBOUND_CREATE: 'inbound.create',
  INBOUND_ASSIGN: 'inbound.assign',
  INBOUND_CONVERT_LEAD: 'inbound.convert_lead',
  INBOUND_CONVERT_REFERRAL: 'inbound.convert_referral',
  INBOUND_DISCARD: 'inbound.discard',
  INBOUND_MANAGE: 'inbound.manage',

  // Dashboard
  DASHBOARD_MODE_TOGGLE: 'dashboard.mode_toggle',

  // Departments
  ADMIN_DEPARTMENTS: 'admin.departments',

  // Patient Snapshot (per-tab edit control in the patient drawer)
  SNAPSHOT_EDIT_REFERRAL: 'snapshot.edit_referral',
  SNAPSHOT_EDIT_DEMOGRAPHICS: 'snapshot.edit_demographics',
  SNAPSHOT_EDIT_TRIAGE: 'snapshot.edit_triage',
  SNAPSHOT_EDIT_F2F: 'snapshot.edit_f2f',
  SNAPSHOT_EDIT_ELIGIBILITY: 'snapshot.edit_eligibility',
  SNAPSHOT_EDIT_NOTES: 'snapshot.edit_notes',
  SNAPSHOT_EDIT_FILES: 'snapshot.edit_files',
  SNAPSHOT_EDIT_TASKS: 'snapshot.edit_tasks',
  SNAPSHOT_EDIT_CLINICAL_REVIEW: 'snapshot.edit_clinical_review',
  SNAPSHOT_EDIT_AUTHORIZATIONS: 'snapshot.edit_authorizations',
  SNAPSHOT_EDIT_CONFLICTS: 'snapshot.edit_conflicts',
  SNAPSHOT_EDIT_PHYSICIAN: 'snapshot.edit_physician',

  // Administration
  ADMIN_USER_MANAGEMENT: 'admin.user_management',
  ADMIN_PERMISSIONS: 'admin.permissions',
  ADMIN_DATA_TOOLS: 'admin.data_tools',
  ADMIN_SETTINGS: 'admin.settings',

  // Developer (raw database access — engineering, not office administration)
  DEVELOPER_TOOLS: 'developer.tools',
};

const K = PERMISSION_KEYS;
const ALL_KEYS = Object.values(K);

// ── Ordered category list (drives UI section rendering) ─────────────────────

// Categories follow how the office actually operates — by module and pipeline
// stage — rather than by internal data table. Note: F2F / MD Orders is treated
// as a NON-clinical step here, and eligibility lives with Authorization.
export const PERMISSION_CATEGORIES = [
  'Access & Modules',
  'Leads & Intake',
  'Inbound Submissions',
  'Eligibility & Authorization',
  'Clinical Review',
  'F2F / MD Orders',
  'OPWDD Enrollment',
  'Scheduling & SOC',
  'Conflicts',
  'Tasks',
  'Patient Record',
  'Directory',
  'Reports',
  'Administration',
  'Developer',
];

// ── Full catalog (UI labels, help text, ordering) ───────────────────────────

export const PERMISSION_CATALOG = [
  // ── Access & Modules ──────────────────────────────────────────────────────
  { key: K.DIVISION_ALF,  label: 'Access ALF division data',          category: 'Access & Modules', description: 'See patients, referrals, and pipeline data tagged ALF', sort: 1 },
  { key: K.DIVISION_SN,   label: 'Access Special Needs division data', category: 'Access & Modules', description: 'See patients, referrals, and pipeline data tagged Special Needs', sort: 2 },
  { key: K.MODULE_INTAKE,        label: 'Open Intake module pages',        category: 'Access & Modules', description: 'Access Leads, Intake, Eligibility, Disenrollment, F2F module pages', sort: 3 },
  { key: K.MODULE_CLINICAL,      label: 'Open Clinical module pages',      category: 'Access & Modules', description: 'Access Clinical RN Review and Conflict module pages', sort: 4 },
  { key: K.MODULE_AUTHORIZATION, label: 'Open Authorization module pages', category: 'Access & Modules', description: 'Access Authorization Pending module page', sort: 5 },
  { key: K.MODULE_SCHEDULING,    label: 'Open Scheduling module pages',    category: 'Access & Modules', description: 'Access Staffing, Pre-SOC, SOC Scheduled, SOC Completed module pages', sort: 6 },
  { key: K.MODULE_ADMIN,         label: 'Open Admin module pages',         category: 'Access & Modules', description: 'Access Admin Confirmation, Hold, and NTUC module pages', sort: 7 },
  { key: K.MODULE_INBOUND,       label: 'Open Inbound Submissions',        category: 'Access & Modules', description: 'Access the inbound email submissions queue', sort: 7.5 },
  { key: K.CALENDAR_VIEW,        label: 'View calendar',                   category: 'Access & Modules', description: 'Access the Calendar page with tasks and F2F dates', sort: 8 },
  { key: K.DASHBOARD_MODE_TOGGLE, label: 'Toggle dashboard mode',          category: 'Access & Modules', description: 'Switch between executive and caseload dashboard views', sort: 9 },

  // ── Inbound Submissions ───────────────────────────────────────────────────
  { key: K.INBOUND_VIEW,              label: 'View inbound submissions',       category: 'Inbound Submissions', description: 'List and open inbound email tickets', sort: 9.1 },
  { key: K.INBOUND_CREATE,            label: 'Create inbound submissions',     category: 'Inbound Submissions', description: 'Manually add a submission (testing / non-email intake)', sort: 9.2 },
  { key: K.INBOUND_ASSIGN,            label: 'Assign inbound submissions',     category: 'Inbound Submissions', description: 'Assign tickets to staff', sort: 9.3 },
  { key: K.INBOUND_CONVERT_LEAD,      label: 'Convert inbound to Lead',        category: 'Inbound Submissions', description: 'Create a Lead Entry referral from an inbound ticket', sort: 9.4 },
  { key: K.INBOUND_CONVERT_REFERRAL,  label: 'Convert inbound to Referral',    category: 'Inbound Submissions', description: 'Create an Intake referral from an inbound ticket', sort: 9.5 },
  { key: K.INBOUND_DISCARD,           label: 'Discard inbound submissions',    category: 'Inbound Submissions', description: 'Discard or mark inbound tickets as spam', sort: 9.6 },
  { key: K.INBOUND_MANAGE,            label: 'Manage all inbound submissions', category: 'Inbound Submissions', description: 'See all tickets (not only assigned), reassign, edit parse suggestions', sort: 9.7 },

  // ── Leads & Intake ────────────────────────────────────────────────────────
  { key: K.LEADS_PROMOTE_TO_INTAKE, label: 'Promote leads to Intake',     category: 'Leads & Intake', description: 'Move a lead from Leads to Intake and assign an owner (supervisor action)', sort: 10 },
  { key: K.LEADS_DISCARD,           label: 'Discard leads',                category: 'Leads & Intake', description: 'Discard a lead with a reason and explanation', sort: 11 },
  { key: K.INTAKE_EMR_INITIAL,      label: 'Complete initial EMR onboarding (ALF)', category: 'Leads & Intake', description: 'Stamp early HCHB chart creation during ALF Intake (does not advance stage; full EMR Onboarding still required later)', sort: 12 },
  { key: K.REFERRAL_CREATE,     label: 'Create new referrals',             category: 'Leads & Intake', description: 'Open the New Referral form and submit', sort: 12 },
  { key: K.REFERRAL_VIEW,       label: 'View referral details',            category: 'Leads & Intake', description: 'See referral cards, drawers, and detail panels', sort: 13 },
  { key: K.REFERRAL_EDIT,       label: 'Edit referral fields',             category: 'Leads & Intake', description: 'Modify referral data in the overview tab', sort: 14 },
  { key: K.REFERRAL_TRANSITION, label: 'Move referrals between stages',    category: 'Leads & Intake', description: 'Advance or regress referrals in the pipeline', sort: 15 },
  { key: K.REFERRAL_HOLD,       label: 'Place referrals on Hold',          category: 'Leads & Intake', description: 'Move any active referral to Hold stage', sort: 16 },
  { key: K.REFERRAL_NTUC,       label: 'Move referrals to NTUC',           category: 'Leads & Intake', description: 'Move referrals to Unable to Convert (terminal)', sort: 17 },
  { key: K.REFERRAL_NTUC_DIRECT, label: 'Send directly to NTUC (bypass Admin Confirmation)', category: 'Leads & Intake', description: 'Skip Admin Confirmation and move a referral directly to NTUC. Without this, NTUC requests go through Admin Confirmation first.', sort: 18 },
  { key: K.REFERRAL_FLAG_URGENT_CARE, label: 'Flag urgent care / pre-assessment', category: 'Leads & Intake', description: 'Mark a patient as requiring urgent pre-SOC care. Adds a red first-aid indicator on every module surface and is visible via the row context menu and the Patient Snapshot.', sort: 19 },
  { key: K.PATIENT_VIEW, label: 'View patient records',      category: 'Leads & Intake', description: 'See patient list, drawer, and details', sort: 20 },
  { key: K.PATIENT_EDIT, label: 'Edit patient information',   category: 'Leads & Intake', description: 'Modify demographics, contacts, and insurance', sort: 21 },

  // ── Eligibility & Authorization ───────────────────────────────────────────
  { key: K.CLINICAL_ELIGIBILITY, label: 'Run eligibility checks',        category: 'Eligibility & Authorization', description: 'Log insurance/eligibility verification results', sort: 30 },
  { key: K.AUTH_SUBMIT, label: 'Submit prior authorizations',            category: 'Eligibility & Authorization', description: 'Create authorization records for managed care', sort: 31 },
  { key: K.AUTH_DECIDE, label: 'Record auth approval or denial',         category: 'Eligibility & Authorization', description: 'Mark authorizations as approved or denied', sort: 32 },
  { key: K.AUTH_REQUEST_SCA, label: 'Request Single Case Agreement',     category: 'Eligibility & Authorization', description: 'Open an SCA tracking record after an SPN denial', sort: 33 },
  { key: K.ROUTING_OPWDD, label: 'Route cases to OPWDD flow',            category: 'Eligibility & Authorization', description: 'Trigger an explicit OPWDD routing action from Eligibility', sort: 34 },
  { key: K.ROUTING_DISENROLLMENT_ASSIST, label: 'Flag for Expert Disenrollment Assist', category: 'Eligibility & Authorization', description: 'Flag a case for expert Medicaid disenrollment assistance (replaces legacy checklist)', sort: 35 },

  // ── Clinical Review ───────────────────────────────────────────────────────
  { key: K.CLINICAL_APPROVED_SERVICES, label: 'Edit approved services', category: 'Clinical Review', description: 'Update which services are approved for a patient in Demographics', sort: 40 },
  { key: K.CLINICAL_TRIAGE,      label: 'Submit triage assessments',     category: 'Clinical Review', description: 'Fill or edit adult/pediatric triage forms', sort: 41 },
  { key: K.CLINICAL_RN_REVIEW,   label: 'Perform Clinical RN review',    category: 'Clinical Review', description: 'Approve or route from Clinical Intake RN Review stage', sort: 42 },

  // ── F2F / MD Orders (non-clinical for our purposes) ───────────────────────
  { key: K.CLINICAL_F2F,    label: 'Log Face-to-Face documents',        category: 'F2F / MD Orders', description: 'Record F2F received dates and expiration', sort: 50 },
  { key: K.FILE_UPLOAD_F2F, label: 'Upload F2F / MD order documents',   category: 'F2F / MD Orders', description: 'Upload Face-to-Face and physician order files', sort: 51 },

  // ── OPWDD Enrollment ──────────────────────────────────────────────────────
  { key: K.OPWDD_CASE_VIEW,            label: 'View OPWDD cases',                    category: 'OPWDD Enrollment', description: 'See OPWDD eligibility cases and their progress',                                   sort: 60 },
  { key: K.OPWDD_CASE_CREATE,          label: 'Open OPWDD cases',                    category: 'OPWDD Enrollment', description: 'Open a new OPWDD eligibility case from a referral (usually automatic)',             sort: 61 },
  { key: K.OPWDD_CASE_EDIT,            label: 'Edit OPWDD case fields',              category: 'OPWDD Enrollment', description: 'Modify OPWDD case status, PCG contact, evaluations, and blockers',                  sort: 62 },
  { key: K.OPWDD_CASE_ASSIGN,          label: 'Assign OPWDD enrollment specialist',  category: 'OPWDD Enrollment', description: 'Assign or reassign the enrollment specialist on an OPWDD case',                    sort: 63 },
  { key: K.OPWDD_CHECKLIST_EDIT,       label: 'Edit OPWDD checklist items',          category: 'OPWDD Enrollment', description: 'Update OPWDD case checklist item statuses (request / receive / accept / reject)',  sort: 64 },
  { key: K.OPWDD_FILE_UPLOAD,          label: 'Upload OPWDD documents',              category: 'OPWDD Enrollment', description: 'Upload documents tagged to an OPWDD case (evaluations, IDs, notices, etc.)',       sort: 65 },
  { key: K.OPWDD_FILE_VERIFY_CURRENT,  label: 'Verify OPWDD document currency',      category: 'OPWDD Enrollment', description: 'Verify an OPWDD evaluation document is current / within its validity window',      sort: 66 },
  { key: K.OPWDD_SUBMIT_PACKET,        label: 'Submit OPWDD packet to CCO',          category: 'OPWDD Enrollment', description: 'Record submission of the OPWDD packet to Care Design NY or Advance Care Alliance', sort: 67 },
  { key: K.OPWDD_RECORD_NOTICE,        label: 'Record OPWDD eligibility notice',     category: 'OPWDD Enrollment', description: 'Record receipt of the OPWDD eligibility / determination notice from the CCO',     sort: 68 },
  { key: K.OPWDD_MARK_CODE95_RECEIVED, label: 'Mark Code 95 received',               category: 'OPWDD Enrollment', description: 'Mark an OPWDD case as having received Code 95 and flip the referral flag',         sort: 69 },
  { key: K.OPWDD_CONVERT_TO_INTAKE,    label: 'Convert OPWDD case to intake',        category: 'OPWDD Enrollment', description: 'Hand a post-Code-95 OPWDD case back to the standard CHHA intake flow',             sort: 70 },
  { key: K.OPWDD_CLOSE_CASE,           label: 'Close OPWDD case',                    category: 'OPWDD Enrollment', description: 'Close an OPWDD eligibility case (PCG declined, ABA-only, duplicate, etc.)',         sort: 71 },

  // ── Scheduling & SOC ──────────────────────────────────────────────────────
  { key: K.SCHEDULING_STAFFING,      label: 'Staffing feasibility actions',      category: 'Scheduling & SOC', description: 'Work the Staffing Feasibility module', sort: 80 },
  { key: K.SCHEDULING_ADMIN_CONFIRM, label: 'Admin Confirmation stage actions',  category: 'Scheduling & SOC', description: 'Confirm patients in Admin Confirmation', sort: 81 },
  { key: K.SCHEDULING_SOC_SCHEDULE,  label: 'Schedule Start of Care',            category: 'Scheduling & SOC', description: 'Set SOC dates and create episodes', sort: 82 },
  { key: K.SCHEDULING_SOC_COMPLETE,  label: 'Mark SOC completed',                category: 'Scheduling & SOC', description: 'Finalize SOC and generate EMR packets', sort: 83 },

  // ── Conflicts ─────────────────────────────────────────────────────────────
  { key: K.CONFLICT_FLAG,             label: 'Flag conflicts',             category: 'Conflicts', description: 'Create conflict records on referrals', sort: 90 },
  { key: K.CONFLICT_RESOLVE,          label: 'Resolve conflicts',          category: 'Conflicts', description: 'Mark conflicts as resolved or waived', sort: 91 },
  { key: K.CONFLICT_MANAGE_CATEGORIES, label: 'Manage conflict categories', category: 'Conflicts', description: 'Add, rename, and enable/disable the conflict category list used across the app', sort: 92 },

  // ── Tasks ─────────────────────────────────────────────────────────────────
  { key: K.TASK_VIEW,     label: 'View tasks',                  category: 'Tasks', description: 'See task lists and details', sort: 100 },
  { key: K.TASK_CREATE,   label: 'Create tasks',                category: 'Tasks', description: 'Create new tasks from drawers or pages', sort: 101 },
  { key: K.TASK_ASSIGN,   label: 'Assign tasks to other users', category: 'Tasks', description: 'Pick an assignee when creating or editing tasks', sort: 102 },
  { key: K.TASK_COMPLETE, label: 'Complete tasks',              category: 'Tasks', description: 'Mark tasks as completed', sort: 103 },

  // ── Patient Record (notes, files, and per-tab snapshot editing) ───────────
  { key: K.FILE_UPLOAD,  label: 'Upload documents',  category: 'Patient Record', description: 'Upload patient files to R2 storage', sort: 110 },
  { key: K.NOTE_CREATE,  label: 'Create notes',      category: 'Patient Record', description: 'Add freeform notes to patient records', sort: 111 },
  { key: K.NOTE_PIN,     label: 'Pin / unpin notes', category: 'Patient Record', description: 'Toggle pinned status on notes', sort: 112 },
  { key: K.SNAPSHOT_EDIT_REFERRAL,         label: 'Edit Referral tab',         category: 'Patient Record', description: 'Modify fields in the Referral tab of the patient drawer',              sort: 113 },
  { key: K.SNAPSHOT_EDIT_DEMOGRAPHICS,     label: 'Edit Demographics tab',     category: 'Patient Record', description: 'Modify fields in the Demographics tab of the patient drawer',          sort: 114 },
  { key: K.SNAPSHOT_EDIT_TRIAGE,           label: 'Edit Triage tab',           category: 'Patient Record', description: 'Fill out or edit triage forms in the patient drawer',                   sort: 115 },
  { key: K.SNAPSHOT_EDIT_F2F,              label: 'Edit Face to Face tab',     category: 'Patient Record', description: 'Log F2F dates and upload documents in the patient drawer',             sort: 116 },
  { key: K.SNAPSHOT_EDIT_ELIGIBILITY,      label: 'Edit Eligibility tab',      category: 'Patient Record', description: 'Log eligibility checks in the patient drawer',                        sort: 117 },
  { key: K.SNAPSHOT_EDIT_NOTES,            label: 'Edit Notes tab',            category: 'Patient Record', description: 'Create and pin notes in the patient drawer',                          sort: 118 },
  { key: K.SNAPSHOT_EDIT_FILES,            label: 'Edit Files tab',            category: 'Patient Record', description: 'Upload and manage files in the patient drawer',                       sort: 119 },
  { key: K.SNAPSHOT_EDIT_TASKS,            label: 'Edit Tasks tab',            category: 'Patient Record', description: 'Create and complete tasks in the patient drawer',                     sort: 120 },
  { key: K.SNAPSHOT_EDIT_CLINICAL_REVIEW,  label: 'Edit Clinical Review tab',  category: 'Patient Record', description: 'Interact with the clinical review checklist in the patient drawer',   sort: 121 },
  { key: K.SNAPSHOT_EDIT_AUTHORIZATIONS,   label: 'Edit Auth tab',             category: 'Patient Record', description: 'Record authorizations in the patient drawer',                        sort: 122 },
  { key: K.SNAPSHOT_EDIT_CONFLICTS,        label: 'Edit Conflicts tab',        category: 'Patient Record', description: 'Resolve conflicts in the patient drawer',                            sort: 123 },
  { key: K.SNAPSHOT_EDIT_PHYSICIAN,        label: 'Edit Physician tab',        category: 'Patient Record', description: 'Set the patient\'s physician and run NPI / PECOS / OPRA verification in the patient drawer', sort: 124 },

  // ── Directory (per-page view / create / edit) ─────────────────────────────
  { key: K.DIRECTORY_MARKETERS_VIEW,   label: 'Marketers · view',   category: 'Directory', description: 'Open and browse the Marketers directory', sort: 130 },
  { key: K.DIRECTORY_MARKETERS_CREATE, label: 'Marketers · create', category: 'Directory', description: 'Add new marketer entries', sort: 131 },
  { key: K.DIRECTORY_MARKETERS_EDIT,   label: 'Marketers · edit',   category: 'Directory', description: 'Edit existing marketer entries', sort: 132 },
  { key: K.DIRECTORY_FACILITIES_VIEW,   label: 'Facilities · view',   category: 'Directory', description: 'Open and browse the Facilities directory', sort: 133 },
  { key: K.DIRECTORY_FACILITIES_CREATE, label: 'Facilities · create', category: 'Directory', description: 'Add new facility entries', sort: 134 },
  { key: K.DIRECTORY_FACILITIES_EDIT,   label: 'Facilities · edit',   category: 'Directory', description: 'Edit existing facility entries', sort: 135 },
  { key: K.FACILITY_EDIT_MARKETERS, label: 'Facilities · edit marketer assignments', category: 'Directory', description: 'Assign or remove marketers from facilities and set primary marketer', sort: 136 },
  { key: K.DIRECTORY_PHYSICIANS_VIEW,   label: 'Physicians · view',   category: 'Directory', description: 'Open and browse the Physicians directory', sort: 137 },
  { key: K.DIRECTORY_PHYSICIANS_CREATE, label: 'Physicians · create', category: 'Directory', description: 'Add new physician entries', sort: 138 },
  { key: K.DIRECTORY_PHYSICIANS_EDIT,   label: 'Physicians · edit',   category: 'Directory', description: 'Edit existing physician entries', sort: 139 },
  { key: K.DIRECTORY_REFERRAL_SOURCES_VIEW,   label: 'Referral Sources · view',   category: 'Directory', description: 'Open and browse the Referral Sources directory', sort: 140 },
  { key: K.DIRECTORY_REFERRAL_SOURCES_CREATE, label: 'Referral Sources · create', category: 'Directory', description: 'Add new referral source entries', sort: 141 },
  { key: K.DIRECTORY_REFERRAL_SOURCES_EDIT,   label: 'Referral Sources · edit',   category: 'Directory', description: 'Edit existing referral source entries', sort: 142 },
  { key: K.DIRECTORY_CLINICIANS_VIEW,   label: 'Clinicians · view',   category: 'Directory', description: 'Open and browse the Clinicians directory', sort: 143 },
  { key: K.DIRECTORY_CLINICIANS_CREATE, label: 'Clinicians · create', category: 'Directory', description: 'Add new clinician entries', sort: 144 },
  { key: K.DIRECTORY_CLINICIANS_EDIT,   label: 'Clinicians · edit',   category: 'Directory', description: 'Edit existing clinician entries', sort: 145 },
  { key: K.DIRECTORY_CAMPAIGNS_VIEW,   label: 'Campaigns · view',   category: 'Directory', description: 'Open and browse the Campaigns directory', sort: 146 },
  { key: K.DIRECTORY_CAMPAIGNS_CREATE, label: 'Campaigns · create', category: 'Directory', description: 'Add new campaign entries', sort: 147 },
  { key: K.DIRECTORY_CAMPAIGNS_EDIT,   label: 'Campaigns · edit',   category: 'Directory', description: 'Edit existing campaign entries', sort: 148 },

  // ── Reports ───────────────────────────────────────────────────────────────
  { key: K.REPORT_VIEW,   label: 'View reports',          category: 'Reports', description: 'Access the Reports page', sort: 160 },
  { key: K.REPORT_EXPORT, label: 'Export reports & data', category: 'Reports', description: 'Download CSV/PDF exports', sort: 161 },

  // ── Administration ────────────────────────────────────────────────────────
  { key: K.ADMIN_DEPARTMENTS,     label: 'Manage departments',      category: 'Administration', description: 'Create, edit, and delete departments, supervisors, members, and scopes', sort: 170 },
  { key: K.ADMIN_USER_MANAGEMENT, label: 'Access User Management',  category: 'Administration', description: 'View and edit users, roles, and statuses', sort: 171 },
  { key: K.ADMIN_PERMISSIONS,     label: 'Manage user permissions', category: 'Administration', description: 'Open permission modals and edit presets', sort: 172 },
  { key: K.ADMIN_DATA_TOOLS,      label: 'Access Data Tools',       category: 'Administration', description: 'Use raw data inspection and admin utilities', sort: 173 },
  { key: K.ADMIN_SETTINGS,        label: 'Access system Settings',  category: 'Administration', description: 'Modify app-wide settings and preferences', sort: 174 },

  // ── Developer ─────────────────────────────────────────────────────────────
  { key: K.DEVELOPER_TOOLS, label: 'Access Developer Tools', category: 'Developer', description: 'Raw database grid: browse, search, and edit any table directly. Engineering use only — every change is audit-logged.', sort: 180 },
];

// ── Default presets (seeded into PermissionPresets table) ────────────────────

export const DEFAULT_PRESETS = [
  {
    id: 'preset_admin',
    name: 'Administrator / CEO',
    description: 'Full unrestricted access to every feature and data set.',
    is_system: true,
    permissions: ALL_KEYS,
  },
  {
    id: 'preset_intake',

    name: 'Intake Coordinator',
    description: 'Front-line referral intake, eligibility, and patient onboarding.',
    is_system: true,
    permissions: [
      K.DIVISION_ALF, K.DIVISION_SN,
      K.LEADS_PROMOTE_TO_INTAKE, K.LEADS_DISCARD, K.INTAKE_EMR_INITIAL,
      K.REFERRAL_CREATE, K.REFERRAL_VIEW, K.REFERRAL_EDIT, K.REFERRAL_TRANSITION, K.REFERRAL_HOLD,
      K.REFERRAL_FLAG_URGENT_CARE,
      K.PATIENT_VIEW, K.PATIENT_EDIT,
      K.CLINICAL_ELIGIBILITY,
      K.ROUTING_OPWDD,
      K.OPWDD_CASE_VIEW, K.OPWDD_CASE_CREATE, K.OPWDD_CASE_EDIT, K.OPWDD_CASE_ASSIGN,
      K.OPWDD_CHECKLIST_EDIT,
      K.OPWDD_FILE_UPLOAD, K.OPWDD_FILE_VERIFY_CURRENT,
      K.OPWDD_SUBMIT_PACKET, K.OPWDD_RECORD_NOTICE,
      K.OPWDD_MARK_CODE95_RECEIVED, K.OPWDD_CONVERT_TO_INTAKE, K.OPWDD_CLOSE_CASE,
      K.TASK_VIEW, K.TASK_CREATE, K.TASK_COMPLETE, K.CALENDAR_VIEW,
      K.FILE_UPLOAD,
      K.NOTE_CREATE, K.NOTE_PIN,
      K.CONFLICT_FLAG,
      K.REPORT_VIEW,
      // Intake needs Physicians/Referral Sources/Facilities/Marketers/Campaigns — not Clinicians (staffing).
      K.DIRECTORY_PHYSICIANS_VIEW, K.DIRECTORY_REFERRAL_SOURCES_VIEW,
      K.DIRECTORY_FACILITIES_VIEW, K.DIRECTORY_MARKETERS_VIEW, K.DIRECTORY_CAMPAIGNS_VIEW,
      K.MODULE_INTAKE,
      K.MODULE_INBOUND,
      K.INBOUND_VIEW, K.INBOUND_CREATE, K.INBOUND_ASSIGN,
      K.INBOUND_CONVERT_LEAD, K.INBOUND_CONVERT_REFERRAL, K.INBOUND_DISCARD, K.INBOUND_MANAGE,
      K.SNAPSHOT_EDIT_REFERRAL, K.SNAPSHOT_EDIT_DEMOGRAPHICS, K.SNAPSHOT_EDIT_ELIGIBILITY,
      K.SNAPSHOT_EDIT_NOTES, K.SNAPSHOT_EDIT_FILES, K.SNAPSHOT_EDIT_TASKS,
      K.SNAPSHOT_EDIT_PHYSICIAN,
    ],
  },
  {
    id: 'preset_clinical_rn',
    name: 'Clinical RN',
    description: 'Clinical intake review, triage, F2F management, and conflict resolution.',
    is_system: true,
    permissions: [
      K.DIVISION_ALF, K.DIVISION_SN,
      K.REFERRAL_VIEW, K.REFERRAL_TRANSITION, K.REFERRAL_HOLD,
      K.REFERRAL_FLAG_URGENT_CARE,
      K.PATIENT_VIEW,
      K.CLINICAL_TRIAGE, K.CLINICAL_RN_REVIEW, K.CLINICAL_F2F, K.CLINICAL_ELIGIBILITY,
      K.TASK_VIEW, K.TASK_CREATE, K.TASK_COMPLETE, K.CALENDAR_VIEW,
      K.FILE_UPLOAD, K.FILE_UPLOAD_F2F,
      K.NOTE_CREATE, K.NOTE_PIN,
      K.CONFLICT_FLAG, K.CONFLICT_RESOLVE,
      K.REPORT_VIEW,
      K.DIRECTORY_CLINICIANS_VIEW, K.DIRECTORY_PHYSICIANS_VIEW,
      K.DIRECTORY_FACILITIES_VIEW, K.DIRECTORY_REFERRAL_SOURCES_VIEW,
      K.MODULE_INTAKE, K.MODULE_CLINICAL,
      K.SNAPSHOT_EDIT_TRIAGE, K.SNAPSHOT_EDIT_F2F, K.SNAPSHOT_EDIT_ELIGIBILITY,
      K.SNAPSHOT_EDIT_NOTES, K.SNAPSHOT_EDIT_FILES, K.SNAPSHOT_EDIT_TASKS,
      K.SNAPSHOT_EDIT_CLINICAL_REVIEW, K.SNAPSHOT_EDIT_CONFLICTS,
      K.SNAPSHOT_EDIT_PHYSICIAN,
    ],
  },
  {
    id: 'preset_marketer',
    name: 'Marketer',
    description: 'Referral creation and patient visibility. Division access depends on marketer assignment.',
    is_system: true,
    permissions: [
      K.REFERRAL_CREATE, K.REFERRAL_VIEW,
      K.PATIENT_VIEW,
      K.TASK_VIEW,
      K.NOTE_CREATE,
      K.FILE_UPLOAD,
      K.MODULE_INBOUND, K.INBOUND_VIEW, K.INBOUND_CONVERT_LEAD, K.INBOUND_CONVERT_REFERRAL,
      K.DIRECTORY_MARKETERS_VIEW, K.DIRECTORY_FACILITIES_VIEW,
      K.DIRECTORY_CAMPAIGNS_VIEW, K.DIRECTORY_REFERRAL_SOURCES_VIEW, K.DIRECTORY_PHYSICIANS_VIEW,
      K.SNAPSHOT_EDIT_NOTES, K.SNAPSHOT_EDIT_FILES,
    ],
  },
  {
    id: 'preset_scheduler',
    name: 'Scheduler',
    description: 'Staffing, SOC scheduling, and post-admission workflow.',
    is_system: true,
    permissions: [
      K.DIVISION_ALF, K.DIVISION_SN,
      K.REFERRAL_VIEW, K.REFERRAL_TRANSITION,
      K.REFERRAL_FLAG_URGENT_CARE,
      K.PATIENT_VIEW,
      K.SCHEDULING_STAFFING, K.SCHEDULING_ADMIN_CONFIRM, K.SCHEDULING_SOC_SCHEDULE, K.SCHEDULING_SOC_COMPLETE,
      K.TASK_VIEW, K.TASK_CREATE, K.TASK_ASSIGN, K.TASK_COMPLETE, K.CALENDAR_VIEW,
      K.NOTE_CREATE,
      K.CONFLICT_FLAG,
      K.REPORT_VIEW,
      // Staffing needs Clinicians — not Physicians.
      K.DIRECTORY_CLINICIANS_VIEW, K.DIRECTORY_FACILITIES_VIEW,
      K.MODULE_SCHEDULING, K.MODULE_ADMIN,
      K.SNAPSHOT_EDIT_NOTES, K.SNAPSHOT_EDIT_TASKS,
    ],
  },
  {
    id: 'preset_finance',
    name: 'Finance / Authorization',
    description: 'Insurance eligibility, prior auth management, and financial reporting.',
    is_system: true,
    permissions: [
      K.DIVISION_ALF, K.DIVISION_SN,
      K.REFERRAL_VIEW,
      K.REFERRAL_FLAG_URGENT_CARE,
      K.PATIENT_VIEW,
      K.CLINICAL_ELIGIBILITY,
      K.AUTH_SUBMIT, K.AUTH_DECIDE, K.AUTH_REQUEST_SCA,
      K.ROUTING_OPWDD, K.ROUTING_DISENROLLMENT_ASSIST,
      K.TASK_VIEW, K.TASK_CREATE, K.CALENDAR_VIEW,
      K.NOTE_CREATE,
      K.CONFLICT_FLAG,
      K.REPORT_VIEW, K.REPORT_EXPORT,
      K.DIRECTORY_FACILITIES_VIEW, K.DIRECTORY_PHYSICIANS_VIEW, K.DIRECTORY_REFERRAL_SOURCES_VIEW,
      K.MODULE_INTAKE, K.MODULE_AUTHORIZATION,
      K.SNAPSHOT_EDIT_ELIGIBILITY, K.SNAPSHOT_EDIT_NOTES, K.SNAPSHOT_EDIT_TASKS,
      K.SNAPSHOT_EDIT_AUTHORIZATIONS, K.SNAPSHOT_EDIT_PHYSICIAN,
    ],
  },
  {
    id: 'preset_field_nurse',
    name: 'Field Nurse',
    description: 'Patient-facing clinical documentation and triage.',
    is_system: true,
    permissions: [
      K.REFERRAL_VIEW,
      K.REFERRAL_FLAG_URGENT_CARE,
      K.PATIENT_VIEW,
      K.CLINICAL_TRIAGE,
      K.NOTE_CREATE,
      K.CONFLICT_FLAG,
      K.FILE_UPLOAD,
      K.DIRECTORY_CLINICIANS_VIEW, K.DIRECTORY_PHYSICIANS_VIEW, K.DIRECTORY_FACILITIES_VIEW,
      K.SNAPSHOT_EDIT_TRIAGE, K.SNAPSHOT_EDIT_NOTES, K.SNAPSHOT_EDIT_FILES,
    ],
  },
];
