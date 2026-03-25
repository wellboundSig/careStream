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

  // Referrals
  REFERRAL_CREATE: 'referral.create',
  REFERRAL_VIEW: 'referral.view',
  REFERRAL_EDIT: 'referral.edit',
  REFERRAL_TRANSITION: 'referral.transition',
  REFERRAL_HOLD: 'referral.hold',
  REFERRAL_NTUC: 'referral.ntuc',
  REFERRAL_NTUC_DIRECT: 'referral.ntuc_direct',

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

  // Directory
  DIRECTORY_VIEW: 'directory.view',
  DIRECTORY_EDIT: 'directory.edit',
  DIRECTORY_CREATE: 'directory.create',

  // Module Visibility (per stage group — controls sidebar and page access)
  MODULE_INTAKE: 'module.intake',
  MODULE_CLINICAL: 'module.clinical',
  MODULE_AUTHORIZATION: 'module.authorization',
  MODULE_SCHEDULING: 'module.scheduling',
  MODULE_ADMIN: 'module.admin',

  // Dashboard
  DASHBOARD_MODE_TOGGLE: 'dashboard.mode_toggle',

  // Administration
  ADMIN_USER_MANAGEMENT: 'admin.user_management',
  ADMIN_PERMISSIONS: 'admin.permissions',
  ADMIN_DATA_TOOLS: 'admin.data_tools',
  ADMIN_SETTINGS: 'admin.settings',
};

const K = PERMISSION_KEYS;
const ALL_KEYS = Object.values(K);

// ── Ordered category list (drives UI section rendering) ─────────────────────

export const PERMISSION_CATEGORIES = [
  'Division Access',
  'Leads',
  'Referrals',
  'Patients',
  'Clinical',
  'Authorization',
  'Tasks',
  'Documents',
  'Notes',
  'Conflicts',
  'Scheduling',
  'Calendar',
  'Reports',
  'Directory',
  'Dashboard',
  'Modules',
  'Administration',
];

// ── Full catalog (UI labels, help text, ordering) ───────────────────────────

export const PERMISSION_CATALOG = [
  // Division Access
  { key: K.DIVISION_ALF,  label: 'Access ALF division data',       category: 'Division Access', description: 'See patients, referrals, and pipeline data tagged ALF', sort: 1 },
  { key: K.DIVISION_SN,   label: 'Access Special Needs division data', category: 'Division Access', description: 'See patients, referrals, and pipeline data tagged Special Needs', sort: 2 },

  // Leads
  { key: K.LEADS_PROMOTE_TO_INTAKE, label: 'Promote leads to Intake',      category: 'Leads', description: 'Move a lead from Leads to Intake and assign an owner (supervisor action)', sort: 8 },
  { key: K.LEADS_DISCARD,           label: 'Discard leads',                 category: 'Leads', description: 'Discard a lead with a reason and explanation', sort: 9 },

  // Referrals
  { key: K.REFERRAL_CREATE,     label: 'Create new referrals',              category: 'Referrals', description: 'Open the New Referral form and submit', sort: 10 },
  { key: K.REFERRAL_VIEW,       label: 'View referral details',             category: 'Referrals', description: 'See referral cards, drawers, and detail panels', sort: 11 },
  { key: K.REFERRAL_EDIT,       label: 'Edit referral fields',              category: 'Referrals', description: 'Modify referral data in the overview tab', sort: 12 },
  { key: K.REFERRAL_TRANSITION, label: 'Move referrals between stages',     category: 'Referrals', description: 'Advance or regress referrals in the pipeline', sort: 13 },
  { key: K.REFERRAL_HOLD,       label: 'Place referrals on Hold',           category: 'Referrals', description: 'Move any active referral to Hold stage', sort: 14 },
  { key: K.REFERRAL_NTUC,       label: 'Move referrals to NTUC',            category: 'Referrals', description: 'Move referrals to Unable to Convert (terminal)', sort: 15 },
  { key: K.REFERRAL_NTUC_DIRECT, label: 'Send directly to NTUC (bypass Admin Confirmation)', category: 'Referrals', description: 'Skip Admin Confirmation and move a referral directly to NTUC. Without this, NTUC requests go through Admin Confirmation first.', sort: 16 },

  // Patients
  { key: K.PATIENT_VIEW, label: 'View patient records',      category: 'Patients', description: 'See patient list, drawer, and details', sort: 20 },
  { key: K.PATIENT_EDIT, label: 'Edit patient information',   category: 'Patients', description: 'Modify demographics, contacts, and insurance', sort: 21 },

  // Clinical
  { key: K.CLINICAL_APPROVED_SERVICES, label: 'Edit approved services', category: 'Clinical', description: 'Update which services are approved for a patient in Demographics', sort: 29 },
  { key: K.CLINICAL_TRIAGE,      label: 'Submit triage assessments',     category: 'Clinical', description: 'Fill or edit adult/pediatric triage forms', sort: 30 },
  { key: K.CLINICAL_RN_REVIEW,   label: 'Perform Clinical RN review',    category: 'Clinical', description: 'Approve or route from Clinical Intake RN Review stage', sort: 31 },
  { key: K.CLINICAL_F2F,         label: 'Log Face-to-Face documents',    category: 'Clinical', description: 'Record F2F received dates and expiration', sort: 32 },
  { key: K.CLINICAL_ELIGIBILITY, label: 'Run eligibility checks',        category: 'Clinical', description: 'Log insurance/eligibility verification results', sort: 33 },

  // Authorization
  { key: K.AUTH_SUBMIT, label: 'Submit prior authorizations',      category: 'Authorization', description: 'Create authorization records for managed care', sort: 40 },
  { key: K.AUTH_DECIDE, label: 'Record auth approval or denial',   category: 'Authorization', description: 'Mark authorizations as approved or denied', sort: 41 },

  // Tasks
  { key: K.TASK_VIEW,     label: 'View tasks',                  category: 'Tasks', description: 'See task lists and details', sort: 50 },
  { key: K.TASK_CREATE,   label: 'Create tasks',                category: 'Tasks', description: 'Create new tasks from drawers or pages', sort: 51 },
  { key: K.TASK_ASSIGN,   label: 'Assign tasks to other users', category: 'Tasks', description: 'Pick an assignee when creating or editing tasks', sort: 52 },
  { key: K.TASK_COMPLETE, label: 'Complete tasks',               category: 'Tasks', description: 'Mark tasks as completed', sort: 53 },

  // Documents
  { key: K.FILE_UPLOAD,     label: 'Upload documents',              category: 'Documents', description: 'Upload patient files to R2 storage', sort: 60 },
  { key: K.FILE_UPLOAD_F2F, label: 'Upload F2F / MD order documents', category: 'Documents', description: 'Upload Face-to-Face and physician order files', sort: 61 },

  // Notes
  { key: K.NOTE_CREATE, label: 'Create notes',     category: 'Notes', description: 'Add freeform notes to patient records', sort: 70 },
  { key: K.NOTE_PIN,    label: 'Pin / unpin notes', category: 'Notes', description: 'Toggle pinned status on notes', sort: 71 },

  // Conflicts
  { key: K.CONFLICT_FLAG,    label: 'Flag conflicts',    category: 'Conflicts', description: 'Create conflict records on referrals', sort: 80 },
  { key: K.CONFLICT_RESOLVE, label: 'Resolve conflicts', category: 'Conflicts', description: 'Mark conflicts as resolved or waived', sort: 81 },

  // Scheduling
  { key: K.SCHEDULING_STAFFING,      label: 'Staffing feasibility actions',      category: 'Scheduling', description: 'Work the Staffing Feasibility module', sort: 90 },
  { key: K.SCHEDULING_ADMIN_CONFIRM, label: 'Admin Confirmation stage actions',  category: 'Scheduling', description: 'Confirm patients in Admin Confirmation', sort: 91 },
  { key: K.SCHEDULING_SOC_SCHEDULE,  label: 'Schedule Start of Care',            category: 'Scheduling', description: 'Set SOC dates and create episodes', sort: 92 },
  { key: K.SCHEDULING_SOC_COMPLETE,  label: 'Mark SOC completed',                category: 'Scheduling', description: 'Finalize SOC and generate EMR packets', sort: 93 },

  // Calendar
  { key: K.CALENDAR_VIEW,  label: 'View calendar',        category: 'Calendar', description: 'Access the Calendar page with tasks and F2F dates', sort: 95 },

  // Reports
  { key: K.REPORT_VIEW,   label: 'View reports',         category: 'Reports', description: 'Access the Reports page', sort: 100 },
  { key: K.REPORT_EXPORT, label: 'Export reports & data', category: 'Reports', description: 'Download CSV/PDF exports', sort: 101 },

  // Directory
  { key: K.DIRECTORY_VIEW,   label: 'View directory pages',     category: 'Directory', description: 'Browse marketers, facilities, physicians, etc.', sort: 110 },
  { key: K.DIRECTORY_EDIT,   label: 'Edit directory entries',    category: 'Directory', description: 'Modify existing directory records', sort: 111 },
  { key: K.DIRECTORY_CREATE, label: 'Create directory entries',  category: 'Directory', description: 'Add new physicians, facilities, etc.', sort: 112 },

  // Dashboard
  { key: K.DASHBOARD_MODE_TOGGLE, label: 'Toggle dashboard mode',   category: 'Dashboard', description: 'Allow user to switch between executive and caseload dashboard views', sort: 113 },

  // Modules
  { key: K.MODULE_INTAKE,        label: 'View Intake modules',         category: 'Modules', description: 'Access Leads, Intake, Eligibility, Disenrollment, F2F module pages', sort: 114 },
  { key: K.MODULE_CLINICAL,      label: 'View Clinical modules',       category: 'Modules', description: 'Access Clinical RN Review and Conflict module pages', sort: 115 },
  { key: K.MODULE_AUTHORIZATION, label: 'View Authorization modules',  category: 'Modules', description: 'Access Authorization Pending module page', sort: 116 },
  { key: K.MODULE_SCHEDULING,    label: 'View Scheduling modules',     category: 'Modules', description: 'Access Staffing, Pre-SOC, SOC Scheduled, SOC Completed module pages', sort: 117 },
  { key: K.MODULE_ADMIN,         label: 'View Admin modules',          category: 'Modules', description: 'Access Admin Confirmation, Hold, and NTUC module pages', sort: 118 },

  // Administration
  { key: K.ADMIN_USER_MANAGEMENT, label: 'Access User Management',    category: 'Administration', description: 'View and edit users, roles, and statuses', sort: 120 },
  { key: K.ADMIN_PERMISSIONS,     label: 'Manage user permissions',    category: 'Administration', description: 'Open permission modals and edit presets', sort: 121 },
  { key: K.ADMIN_DATA_TOOLS,      label: 'Access Data Tools',          category: 'Administration', description: 'Use raw data inspection and admin utilities', sort: 122 },
  { key: K.ADMIN_SETTINGS,        label: 'Access system Settings',     category: 'Administration', description: 'Modify app-wide settings and preferences', sort: 123 },
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
      K.LEADS_PROMOTE_TO_INTAKE, K.LEADS_DISCARD,
      K.REFERRAL_CREATE, K.REFERRAL_VIEW, K.REFERRAL_EDIT, K.REFERRAL_TRANSITION, K.REFERRAL_HOLD,
      K.PATIENT_VIEW, K.PATIENT_EDIT,
      K.CLINICAL_ELIGIBILITY,
      K.TASK_VIEW, K.TASK_CREATE, K.TASK_COMPLETE, K.CALENDAR_VIEW,
      K.FILE_UPLOAD,
      K.NOTE_CREATE, K.NOTE_PIN,
      K.CONFLICT_FLAG,
      K.REPORT_VIEW,
      K.DIRECTORY_VIEW,
      K.MODULE_INTAKE,
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
      K.PATIENT_VIEW,
      K.CLINICAL_TRIAGE, K.CLINICAL_RN_REVIEW, K.CLINICAL_F2F, K.CLINICAL_ELIGIBILITY,
      K.TASK_VIEW, K.TASK_CREATE, K.TASK_COMPLETE, K.CALENDAR_VIEW,
      K.FILE_UPLOAD, K.FILE_UPLOAD_F2F,
      K.NOTE_CREATE, K.NOTE_PIN,
      K.CONFLICT_FLAG, K.CONFLICT_RESOLVE,
      K.REPORT_VIEW,
      K.DIRECTORY_VIEW,
      K.MODULE_INTAKE, K.MODULE_CLINICAL,
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
      K.DIRECTORY_VIEW,
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
      K.PATIENT_VIEW,
      K.SCHEDULING_STAFFING, K.SCHEDULING_ADMIN_CONFIRM, K.SCHEDULING_SOC_SCHEDULE, K.SCHEDULING_SOC_COMPLETE,
      K.TASK_VIEW, K.TASK_CREATE, K.TASK_ASSIGN, K.TASK_COMPLETE, K.CALENDAR_VIEW,
      K.NOTE_CREATE,
      K.REPORT_VIEW,
      K.DIRECTORY_VIEW,
      K.MODULE_SCHEDULING, K.MODULE_ADMIN,
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
      K.PATIENT_VIEW,
      K.CLINICAL_ELIGIBILITY,
      K.AUTH_SUBMIT, K.AUTH_DECIDE,
      K.TASK_VIEW, K.TASK_CREATE, K.CALENDAR_VIEW,
      K.NOTE_CREATE,
      K.REPORT_VIEW, K.REPORT_EXPORT,
      K.DIRECTORY_VIEW,
      K.MODULE_INTAKE, K.MODULE_AUTHORIZATION,
    ],
  },
  {
    id: 'preset_field_nurse',
    name: 'Field Nurse',
    description: 'Patient-facing clinical documentation and triage.',
    is_system: true,
    permissions: [
      K.REFERRAL_VIEW,
      K.PATIENT_VIEW,
      K.CLINICAL_TRIAGE,
      K.NOTE_CREATE,
      K.FILE_UPLOAD,
      K.DIRECTORY_VIEW,
    ],
  },
];
