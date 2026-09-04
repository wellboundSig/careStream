/**
 * Payer → clearinghouse routing for real-time eligibility (270/271).
 *
 * Each rule maps a payer (by name pattern / insurance category) to the payer
 * IDs each clearinghouse expects and the order in which to try them. The
 * smart endpoint (/eligibility/check) walks the route, skipping clearinghouses
 * that are unconfigured or have no payer ID, and stops at the first
 * conclusive answer (confirmed_active / confirmed_inactive).
 *
 * IDs marked null = not yet mapped/enrolled. Filling these in is the payer
 * mapping work: Availity payer list + Waystar payer list + Optum trading
 * partners. Unmapped payers fall through to manual verification (ePACES /
 * payer portal), same as today.
 */

import { runOptumEligibilityCheck } from './optumEligibility.js';
import { runAvailityEligibilityCheck } from './availityEligibility.js';
import { runWaystarEligibilityCheck } from './waystarEligibility.js';

// Route orders, by payer class:
//   Medicare FFS   → Optum (CMS) first, Waystar fallback
//   NY Medicaid    → Optum (MCDNY) first (ePACES stays the manual fallback)
//   Commercial/MA  → Availity first (native for Anthem/Aetna/BCBS/Humana), Optum fallback
//   MLTC/regional  → Waystar (broadest payer list) once payload contract is verified
export const PAYER_ROUTES = [
  { match: /\bmedicare\b(?!.*advantage)/i, category: 'medicare', label: 'Medicare FFS',
    ids: { optum: 'CMS', availity: null, waystar: 'MEDICARE' }, route: ['optum', 'waystar'] },
  { match: /medicaid(?!.*managed)|emedny|epaces/i, category: 'medicaid', label: 'NY Medicaid FFS',
    ids: { optum: 'MCDNY', availity: null, waystar: 'NYMEDICAID' }, route: ['optum', 'waystar'] },

  // Nationals — strong Availity + Optum coverage
  { match: /united ?health|\buhc\b|oxford/i, label: 'UnitedHealthcare',
    ids: { optum: '87726', availity: '87726', waystar: '87726' }, route: ['availity', 'optum', 'waystar'] },
  { match: /aetna/i, label: 'Aetna',
    ids: { optum: '60054', availity: '60054', waystar: '60054' }, route: ['availity', 'optum', 'waystar'] },
  { match: /cigna/i, label: 'Cigna',
    ids: { optum: '62308', availity: '62308', waystar: '62308' }, route: ['availity', 'optum', 'waystar'] },
  { match: /humana/i, label: 'Humana',
    ids: { optum: '61101', availity: '61101', waystar: '61101' }, route: ['availity', 'optum', 'waystar'] },
  { match: /empire|anthem|blue ?cross|blue ?shield|\bbcbs\b|horizon/i, label: 'Anthem / BCBS family',
    ids: { optum: '00303', availity: '00303', waystar: '00303' }, route: ['availity', 'optum', 'waystar'] },

  // NY regionals — Optum IDs known; Availity/Waystar IDs pending payer-list mapping
  { match: /fidelis/i, label: 'Fidelis Care',
    ids: { optum: '11315', availity: null, waystar: '11315' }, route: ['optum', 'waystar'] },
  { match: /healthfirst|hfny/i, label: 'Healthfirst',
    ids: { optum: '80141', availity: null, waystar: '80141' }, route: ['optum', 'waystar'] },
  { match: /elder.?serve|riverspring/i, label: 'ElderServe / RiverSpring',
    ids: { optum: '05178', availity: null, waystar: null }, route: ['optum'] },
  { match: /metroplus/i, label: 'MetroPlus',
    ids: { optum: null, availity: null, waystar: '13265' }, route: ['waystar'] },
  { match: /emblem|(?<!\w)ghi(?!\w)|(?<!\w)hip(?!\w)/i, label: 'EmblemHealth / GHI / HIP',
    ids: { optum: null, availity: null, waystar: null }, route: [] },

  // MLTC / niche NY plans — Waystar payer list is the likely path; IDs pending
  { match: /vns|villagecare|elderplan|homefirst|centers plan|agewell|integra|senior whole|amida|archcare|hamaspik|montefiore|partners health|longevity|molina|wellcare|amerigroup|wellpoint|1199|magnacare|multiplan|mvp|cdphp|excellus|independent health|oscar|husky|connecticare|braven|qualcare|amerihealth|nj familycare|tricare|veterans/i,
    label: 'Regional / MLTC (pending payer-ID mapping)',
    ids: { optum: null, availity: null, waystar: null }, route: [] },
];

export function routeForInsurance(insurance = {}) {
  const name = String(insurance.payer_display_name || insurance.plan_name || '').trim();
  const cat = String(insurance.insurance_category || '').toLowerCase();
  for (const rule of PAYER_ROUTES) {
    if (rule.match.test(name) || (rule.category && cat.includes(rule.category))) {
      return rule;
    }
  }
  return null;
}

function clearinghouseConfigured(ch) {
  if (ch === 'optum') return !!(process.env.OPTUM_CLIENT_ID && process.env.OPTUM_CLIENT_SECRET);
  if (ch === 'availity') return !!(process.env.AVAILITY_CLIENT_ID && process.env.AVAILITY_CLIENT_SECRET);
  if (ch === 'waystar') return !!(process.env.WAYSTAR_API_USERID && process.env.WAYSTAR_API_PASSWORD);
  return false;
}

const RUNNERS = {
  optum: (input, payerId) => runOptumEligibilityCheck({ ...input, tradingPartnerServiceId: payerId }),
  availity: (input, payerId) => runAvailityEligibilityCheck({ ...input, payerId }),
  waystar: (input, payerId) => runWaystarEligibilityCheck({ ...input, payerId }),
};

const CONCLUSIVE = new Set(['confirmed_active', 'confirmed_inactive']);

/**
 * Smart eligibility check: route by payer, walk the clearinghouse chain,
 * stop at the first conclusive answer. Returns every attempt for the UI.
 *
 * @param {object} input — { patient, insurance, clearinghouse?, payerId? }
 */
export async function runSmartEligibilityCheck(input = {}) {
  const insurance = input.insurance || {};
  const rule = routeForInsurance(insurance);

  // Explicit clearinghouse override (e.g. from the UI) wins.
  let chain;
  if (input.clearinghouse && RUNNERS[input.clearinghouse]) {
    chain = [input.clearinghouse];
  } else if (rule && rule.route.length) {
    chain = rule.route;
  } else {
    // No mapping — fall back to Optum's guesser (it may still find an ID).
    chain = ['optum'];
  }

  const attempts = [];
  for (const ch of chain) {
    if (!clearinghouseConfigured(ch)) {
      attempts.push({ clearinghouse: ch, skipped: true, reason: 'not configured (missing credentials on API)' });
      continue;
    }
    const payerId = input.payerId || rule?.ids?.[ch] || null;
    if (!payerId && ch !== 'optum') {
      // Optum has its own name-based guesser; others need an explicit ID.
      attempts.push({ clearinghouse: ch, skipped: true, reason: 'no payer ID mapped for this clearinghouse' });
      continue;
    }
    const result = await RUNNERS[ch](input, payerId);
    attempts.push(result);
    if (result.ok && CONCLUSIVE.has(result.summary?.suggestedStatus)) {
      return { ok: true, route: rule?.label || null, conclusive: true, result, attempts };
    }
  }

  // Nothing conclusive — surface the best attempt (last real one) for review.
  const real = attempts.filter((a) => !a.skipped);
  return {
    ok: real.some((a) => a.ok),
    route: rule?.label || null,
    conclusive: false,
    result: real[real.length - 1] || null,
    attempts,
  };
}
