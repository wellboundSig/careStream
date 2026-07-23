import {
  STAGES,
  DIVISIONS,
  runIntakeVolume,
  runMarketerPerformance,
  runSourceAttribution,
  runSocCompleted,
  PRESETS,
} from '../utils/reportEngine.js';

function presetById(id) {
  return PRESETS.find((p) => p.id === id);
}

/** Default last-30-days range (calendar YYYY-MM-DD). */
export function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  return { dateFrom: fmt(from), dateTo: fmt(to) };
}

export const EMPTY_SLOTS = {
  dateFrom: '',
  dateTo: '',
  division: '',
  stages: [],
  marketerIds: [],
  ownerIds: [],
  sourceIds: [],
};

/**
 * Six purpose-driven mad-lib templates (v1).
 * Each has a fixed sentence (rendered in GuidedReports) and a runner.
 */
export const GUIDED_TEMPLATES = [
  {
    id: 'intake_volume',
    title: 'Intake Volume',
    description: 'Leads created in a date range — volume, owners, and stage mix.',
    icon: 'intake_volume',
    dateField: 'referral_date',
    slots: ['dateRange', 'division', 'owners', 'marketers'],
    defaultSlots: () => ({ ...EMPTY_SLOTS, ...defaultDateRange() }),
    fields: [
      { name: 'referral_date', label: 'Referral date', inputType: 'date' },
      { name: 'division', label: 'Division', values: DIVISIONS.map((d) => ({ name: d, label: d })) },
      { name: 'intake_owner_id', label: 'Intake owner', inputType: 'text' },
      { name: 'marketer_id', label: 'Marketer', inputType: 'text' },
      { name: 'current_stage', label: 'Stage', values: STAGES.map((s) => ({ name: s, label: s })) },
    ],
    async run(slots) {
      return runIntakeVolume({
        dateFrom: slots.dateFrom,
        dateTo: slots.dateTo,
        division: slots.division || undefined,
        ownerIds: slots.ownerIds,
        marketerIds: slots.marketerIds,
      });
    },
  },
  {
    id: 'marketer_performance',
    title: 'Marketer Performance',
    description: 'Referrals, SOC rate, and NTUC rate by marketer.',
    icon: 'marketer_performance',
    dateField: 'referral_date',
    slots: ['dateRange', 'division', 'marketers'],
    defaultSlots: () => ({ ...EMPTY_SLOTS, ...defaultDateRange() }),
    fields: [
      { name: 'referral_date', label: 'Referral date', inputType: 'date' },
      { name: 'division', label: 'Division', values: DIVISIONS.map((d) => ({ name: d, label: d })) },
      { name: 'marketer_id', label: 'Marketer', inputType: 'text' },
    ],
    async run(slots) {
      return runMarketerPerformance({
        dateFrom: slots.dateFrom,
        dateTo: slots.dateTo,
        division: slots.division || undefined,
        marketerIds: slots.marketerIds,
      });
    },
  },
  {
    id: 'pipeline_snapshot',
    title: 'Pipeline Snapshot',
    description: 'Patients currently in selected stages, with marketer and F2F context.',
    icon: 'pipeline_snapshot',
    dateField: 'referral_date',
    slots: ['stages', 'division', 'marketers', 'dateRange'],
    defaultSlots: () => ({
      ...EMPTY_SLOTS,
      stages: ['Intake', 'Clinical Intake RN Review', 'Pre-SOC', 'SOC Scheduled'],
    }),
    fields: [
      { name: 'current_stage', label: 'Stage', values: STAGES.map((s) => ({ name: s, label: s })) },
      { name: 'division', label: 'Division', values: DIVISIONS.map((d) => ({ name: d, label: d })) },
      { name: 'marketer_id', label: 'Marketer', inputType: 'text' },
      { name: 'referral_date', label: 'Referral date', inputType: 'date' },
    ],
    async run(slots) {
      const preset = presetById('pipeline_snapshot');
      return preset.run({
        dateFrom: slots.dateFrom || undefined,
        dateTo: slots.dateTo || undefined,
        division: slots.division || undefined,
        stages: slots.stages,
        marketerIds: slots.marketerIds,
      });
    },
  },
  {
    id: 'soc_completed',
    title: 'Start of Care',
    description: 'SOC completed in a date range — the “SOC report” for managers.',
    icon: 'soc_completed',
    dateField: 'soc_completed_date',
    slots: ['dateRange', 'division', 'marketers', 'owners'],
    defaultSlots: () => ({ ...EMPTY_SLOTS, ...defaultDateRange() }),
    fields: [
      { name: 'soc_completed_date', label: 'SOC completed date', inputType: 'date' },
      { name: 'division', label: 'Division', values: DIVISIONS.map((d) => ({ name: d, label: d })) },
      { name: 'marketer_id', label: 'Marketer', inputType: 'text' },
      { name: 'intake_owner_id', label: 'Intake owner', inputType: 'text' },
    ],
    async run(slots) {
      return runSocCompleted({
        dateFrom: slots.dateFrom,
        dateTo: slots.dateTo,
        division: slots.division || undefined,
        marketerIds: slots.marketerIds,
        ownerIds: slots.ownerIds,
      });
    },
  },
  {
    id: 'ntuc_analysis',
    title: 'NTUC Analysis',
    description: 'Cases that ended as Not to Utilize Care.',
    icon: 'ntuc_analysis',
    dateField: 'referral_date',
    slots: ['dateRange', 'division', 'marketers', 'sources'],
    defaultSlots: () => ({ ...EMPTY_SLOTS, ...defaultDateRange() }),
    fields: [
      { name: 'referral_date', label: 'Referral date', inputType: 'date' },
      { name: 'division', label: 'Division', values: DIVISIONS.map((d) => ({ name: d, label: d })) },
      { name: 'marketer_id', label: 'Marketer', inputType: 'text' },
      { name: 'referral_source_id', label: 'Source', inputType: 'text' },
    ],
    async run(slots) {
      const preset = presetById('ntuc_analysis');
      return preset.run({
        dateFrom: slots.dateFrom,
        dateTo: slots.dateTo,
        division: slots.division || undefined,
        marketerIds: slots.marketerIds,
        sourceIds: slots.sourceIds,
      });
    },
  },
  {
    id: 'source_attribution',
    title: 'Source Attribution',
    description: 'Referral outcomes by lead source — SOC and NTUC rates.',
    icon: 'source_attribution',
    dateField: 'referral_date',
    slots: ['dateRange', 'division', 'sources'],
    defaultSlots: () => ({ ...EMPTY_SLOTS, ...defaultDateRange() }),
    fields: [
      { name: 'referral_date', label: 'Referral date', inputType: 'date' },
      { name: 'division', label: 'Division', values: DIVISIONS.map((d) => ({ name: d, label: d })) },
      { name: 'referral_source_id', label: 'Source', inputType: 'text' },
    ],
    async run(slots) {
      return runSourceAttribution({
        dateFrom: slots.dateFrom,
        dateTo: slots.dateTo,
        division: slots.division || undefined,
        sourceIds: slots.sourceIds,
      });
    },
  },
];

export function getGuidedTemplate(id) {
  return GUIDED_TEMPLATES.find((t) => t.id === id) || GUIDED_TEMPLATES[0];
}
