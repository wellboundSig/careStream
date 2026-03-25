/**
 * Navigation data for the split-screen right pane.
 * Pure data — no React imports — so PaneNavigation can stay lightweight.
 */
export const PANE_NAV = [
  {
    group: 'Main',
    items: [
      { path: '/', label: 'Dashboard' },
      { path: '/pipeline', label: 'Pipeline' },
      { path: '/patients', label: 'Patients' },
      { path: '/pending', label: 'Pending Approval' },
    ],
  },
  {
    group: 'Modules',
    items: [
      { path: '/modules/lead-entry', label: 'Leads' },
      { path: '/modules/discarded-leads', label: 'Discarded Leads' },
      { path: '/modules/intake', label: 'Intake' },
      { path: '/modules/eligibility', label: 'Eligibility' },
      { path: '/modules/disenrollment', label: 'Disenrollment' },
      { path: '/modules/f2f', label: 'F2F / MD Orders' },
      { path: '/modules/clinical-rn', label: 'Clinical RN Review' },
      { path: '/modules/authorization', label: 'Authorization' },
      { path: '/modules/conflict', label: 'Conflict' },
      { path: '/modules/staffing', label: 'Staffing' },
      { path: '/modules/admin-confirmation', label: 'Admin Confirmation' },
      { path: '/modules/pre-soc', label: 'Pre-SOC' },
      { path: '/modules/soc-completed', label: 'Completed' },
      { path: '/modules/hold', label: 'Hold' },
      { path: '/modules/ntuc', label: 'NTUC' },
    ],
  },
  {
    group: 'Directory',
    items: [
      { path: '/directory/marketers', label: 'Marketers' },
      { path: '/directory/facilities', label: 'Facilities' },
      { path: '/directory/physicians', label: 'Physicians' },
      { path: '/directory/campaigns', label: 'Campaigns' },
      { path: '/directory/referral-sources', label: 'Referral Sources' },
    ],
  },
  {
    group: 'Work',
    items: [
      { path: '/tasks', label: 'Tasks' },
      { path: '/reports', label: 'Reports' },
    ],
  },
  {
    group: 'System',
    items: [
      { path: '/team', label: 'Team' },
      { path: '/admin/settings', label: 'Settings' },
    ],
  },
];
