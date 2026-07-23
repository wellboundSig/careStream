/**
 * Headless react-querybuilder → CareStream filterByFormula adapter.
 * No Mongo/SQL export — we compile to the same filter objects / formula
 * strings that reportEngine.buildFormula already understands.
 */

import { isRuleGroupType } from 'react-querybuilder';
import { buildFormula } from './reportEngine.js';

/** Map RQB operator names → CareStream buildFormula operators. */
const OP_MAP = {
  '=': 'eq',
  '!=': 'neq',
  contains: 'contains',
  beginsWith: 'contains',
  endsWith: 'contains',
  null: 'is_empty',
  notNull: 'not_empty',
  in: 'in',
  notIn: 'neq', // approximated; prefer `in` for multi
  '<': 'before',
  '>': 'after',
  '<=': 'before',
  '>=': 'after',
  between: 'between',
  true: 'true',
  false: 'false',
  // CareStream-native aliases (also allowed in query JSON)
  eq: 'eq',
  neq: 'neq',
  is_empty: 'is_empty',
  not_empty: 'not_empty',
  before: 'before',
  after: 'after',
  gt: 'gt',
  lt: 'lt',
  gte: 'gte',
  lte: 'lte',
};

function normalizeBetween(value) {
  if (Array.isArray(value) && value.length >= 2) {
    return { value: value[0], value2: value[1] };
  }
  if (typeof value === 'string' && value.includes(',')) {
    const [a, b] = value.split(',').map((s) => s.trim());
    return { value: a, value2: b };
  }
  return { value, value2: undefined };
}

/**
 * Flatten a rule (leaf) into a CareStream filter object, or null if incomplete.
 */
export function ruleToFilter(rule) {
  if (!rule?.field || !rule?.operator) return null;
  const op = OP_MAP[rule.operator] || rule.operator;
  if (op === 'is_empty' || op === 'not_empty' || op === 'true' || op === 'false') {
    return { field: rule.field, operator: op };
  }
  if (op === 'between') {
    const { value, value2 } = normalizeBetween(rule.value);
    if (!value) return null;
    return { field: rule.field, operator: 'between', value, value2 };
  }
  if (op === 'in') {
    let v = rule.value;
    if (typeof v === 'string') v = v.split(',').map((s) => s.trim()).filter(Boolean);
    if (!Array.isArray(v) || v.length === 0) return null;
    return { field: rule.field, operator: 'in', value: v };
  }
  if (rule.value === undefined || rule.value === null || rule.value === '') return null;
  return { field: rule.field, operator: op, value: rule.value, value2: rule.value2 };
}

/**
 * Convert an RQB RuleGroup into a nested formula string supporting AND/OR.
 * Falls back to buildFormula for a flat AND list when possible.
 */
export function ruleGroupToFormula(group) {
  if (!group) return '';
  const combinator = (group.combinator || 'and').toLowerCase() === 'or' ? 'OR' : 'AND';
  const parts = [];

  for (const rule of group.rules || []) {
    if (isRuleGroupType(rule)) {
      const nested = ruleGroupToFormula(rule);
      if (nested) parts.push(nested);
      continue;
    }
    const filter = ruleToFilter(rule);
    if (!filter) continue;
    const piece = buildFormula([filter]);
    if (piece) parts.push(piece);
  }

  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${combinator}(${parts.join(',')})`;
}

/**
 * Flatten a (preferably AND) rule group into CareStream filter objects.
 * Nested OR groups become a single `in` when every branch is field=eq same field;
 * otherwise returns { filters, formula } with formula for the complex case.
 */
export function queryToFilters(query) {
  if (!query) return { filters: [], formula: '' };

  const combinator = (query.combinator || 'and').toLowerCase();
  const filters = [];
  let needsFormula = combinator === 'or';

  for (const rule of query.rules || []) {
    if (isRuleGroupType(rule)) {
      needsFormula = true;
      continue;
    }
    const f = ruleToFilter(rule);
    if (f) filters.push(f);
  }

  if (needsFormula || (query.rules || []).some(isRuleGroupType)) {
    return { filters, formula: ruleGroupToFormula(query) };
  }
  return { filters, formula: buildFormula(filters) };
}

/**
 * Build a fresh RQB query from guided slot params.
 */
export function slotsToQuery(slots = {}, fieldMap = {}) {
  const rules = [];
  const {
    dateFrom, dateTo, dateField = 'referral_date',
    division, stages, marketerIds, ownerIds, sourceIds,
  } = slots;

  if (dateFrom && dateTo) {
    rules.push({
      field: dateField,
      operator: 'between',
      value: [dateFrom, dateTo],
      ...(fieldMap[dateField] ? {} : {}),
    });
  } else if (dateFrom) {
    rules.push({ field: dateField, operator: 'after', value: dateFrom });
  } else if (dateTo) {
    rules.push({ field: dateField, operator: 'before', value: dateTo });
  }

  if (division) {
    rules.push({ field: 'division', operator: '=', value: division });
  }
  if (Array.isArray(stages) && stages.length) {
    rules.push({ field: 'current_stage', operator: 'in', value: stages });
  }
  if (Array.isArray(marketerIds) && marketerIds.length) {
    rules.push({ field: 'marketer_id', operator: 'in', value: marketerIds });
  }
  if (Array.isArray(ownerIds) && ownerIds.length) {
    rules.push({ field: 'intake_owner_id', operator: 'in', value: ownerIds });
  }
  if (Array.isArray(sourceIds) && sourceIds.length) {
    rules.push({ field: 'referral_source_id', operator: 'in', value: sourceIds });
  }

  return { combinator: 'and', rules };
}

/**
 * Best-effort extract of guided slots from an RQB query (for sentence sync).
 */
export function queryToSlots(query, { dateField = 'referral_date' } = {}) {
  const slots = {
    dateFrom: '',
    dateTo: '',
    division: '',
    stages: [],
    marketerIds: [],
    ownerIds: [],
    sourceIds: [],
  };
  if (!query?.rules) return slots;

  for (const rule of query.rules) {
    if (isRuleGroupType(rule)) continue;
    const f = ruleToFilter(rule);
    if (!f) continue;
    if (f.field === dateField && f.operator === 'between') {
      slots.dateFrom = f.value || '';
      slots.dateTo = f.value2 || '';
    } else if (f.field === dateField && f.operator === 'after') {
      slots.dateFrom = f.value || '';
    } else if (f.field === dateField && f.operator === 'before') {
      slots.dateTo = f.value || '';
    } else if (f.field === 'division' && f.operator === 'eq') {
      slots.division = f.value || '';
    } else if (f.field === 'current_stage' && f.operator === 'in') {
      slots.stages = [...f.value];
    } else if (f.field === 'current_stage' && f.operator === 'eq') {
      slots.stages = [f.value];
    } else if (f.field === 'marketer_id' && (f.operator === 'in' || f.operator === 'eq')) {
      slots.marketerIds = f.operator === 'in' ? [...f.value] : [f.value];
    } else if (f.field === 'intake_owner_id' && (f.operator === 'in' || f.operator === 'eq')) {
      slots.ownerIds = f.operator === 'in' ? [...f.value] : [f.value];
    } else if (f.field === 'referral_source_id' && (f.operator === 'in' || f.operator === 'eq')) {
      slots.sourceIds = f.operator === 'in' ? [...f.value] : [f.value];
    }
  }
  return slots;
}

/** CareStream-flavored operators for the Advanced RQB UI. */
export const CARESTREAM_OPERATORS = [
  { name: '=', label: 'is' },
  { name: '!=', label: 'is not' },
  { name: 'contains', label: 'contains' },
  { name: 'in', label: 'is any of' },
  { name: 'between', label: 'between' },
  { name: 'after', label: 'after' },
  { name: 'before', label: 'before' },
  { name: 'notNull', label: 'is not empty' },
  { name: 'null', label: 'is empty' },
  { name: 'true', label: 'is true' },
  { name: 'false', label: 'is false' },
];
