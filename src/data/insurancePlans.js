/**
 * Known payers for NY / NJ / CT (tri-state) home health & MLTC intake.
 * Stored as payer_display_name strings on PatientInsurances — keep labels stable.
 */
const RAW_INSURANCE_PLANS = [
  // Government / self
  'Medicaid',
  'Medicare',
  'Medicare Advantage',
  'Self-Pay',
  'Private Pay',
  'Workers Compensation',
  'No Fault',
  'Tricare',
  'Veterans Affairs (VA)',

  // Existing Wellbound staples (keep exact names)
  'Fidelis Care',
  'Fidelis Care at Home',
  'UnitedHealthcare Community Plan',
  'Healthfirst',
  'Healthfirst CompleteCare',
  'Aetna Better Health',
  'Molina Healthcare',
  'Anthem BCBS',
  'Humana',
  'Wellcare',
  'Hamaspik',
  'VNS Health',
  'MetroPlus MLTC',
  'MetroPlus HMO',
  'Elderplan HomeFirst',
  'Montefiore Diamond Care',

  // User-requested + NYC commercial
  'NYC PPO',
  'Empire BCBS NYC PPO',
  'Empire BlueCross BlueShield',
  'Empire BlueCross BlueShield HealthPlus',
  'Empire BCBS PPO',
  'Anthem BCBS PPO',

  // NY Medicaid managed care / MLTC / MAP / PACE-adjacent
  'Affinity by Molina',
  'AgeWell New York',
  'Amida Care',
  'ArchCare Community Life',
  'ArchCare Senior Life',
  'Centers Plan for Healthy Living',
  'Centers Plan MLTC',
  'Elderplan',
  'ElderServe Health',
  'Hamaspik Choice',
  'Hamaspik Choice MLTC',
  'Healthfirst AbsoluteCare',
  'Healthfirst Leaf Plan',
  'Integra MLTC',
  'Longevity Health Plan',
  'MetroPlus Health Plan',
  'MetroPlus Medicaid Managed Care',
  'Montefiore CMO',
  'Partners Health Plan',
  'RiverSpring MLTC',
  'Senior Whole Health',
  'VillageCareMAX',
  'VNS Health EasyCare',
  'VNS Health MLTC',
  'VNSNY CHOICE',
  'Aetna Better Health of New York',
  'Molina Healthcare of New York',
  'UnitedHealthcare Dual Complete',
  'Wellcare Dual Liberty',
  'Wellcare by Fidelis',

  // NY commercial / employer
  'Aetna',
  'Aetna PPO',
  'Cigna',
  'Cigna PPO',
  'UnitedHealthcare',
  'UnitedHealthcare Oxford',
  'Oxford Health Plans',
  'EmblemHealth',
  'EmblemHealth GHI',
  'EmblemHealth HIP',
  'EmblemHealth PPO',
  'GHI',
  'HIP',
  'Oscar Health',
  'Oscar PPO',
  'MagnaCare',
  'MultiPlan',
  '1199SEIU National Benefit Fund',
  'MVP Health Care',
  'CDPHP',
  'Excellus BlueCross BlueShield',
  'Independent Health',
  'Blue Cross Blue Shield',
  'Humana Gold Plus',
  'Humana Medicare Advantage',

  // New Jersey
  'Horizon NJ Health',
  'Horizon Blue Cross Blue Shield of New Jersey',
  'Horizon BCBS NJ PPO',
  'Aetna Better Health of New Jersey',
  'UnitedHealthcare Community Plan of New Jersey',
  'Amerigroup New Jersey',
  'Wellpoint New Jersey',
  'WellCare of New Jersey',
  'AmeriHealth New Jersey',
  'Braven Health',
  'QualCare',
  'NJ FamilyCare',
  'Horizon Medicare Advantage',

  // Connecticut
  'HUSKY Health (Connecticut Medicaid)',
  'Anthem Blue Cross Blue Shield of Connecticut',
  'ConnectiCare',
  'ConnectiCare Medicare Advantage',
  'Aetna Better Health of Connecticut',
  'UnitedHealthcare Community Plan of Connecticut',
  'Community Health Network of Connecticut',
  'Yale Health',
];

/** Alphabetized, de-duplicated list for dropdowns. */
export const INSURANCE_PLANS = [...new Set(RAW_INSURANCE_PLANS)]
  .map((s) => String(s).trim())
  .filter(Boolean)
  .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

/** Case-insensitive substring filter for searchable pickers. */
export function filterInsurancePlans(query, plans = INSURANCE_PLANS) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return plans;
  return plans.filter((p) => p.toLowerCase().includes(q));
}
