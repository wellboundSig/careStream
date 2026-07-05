import { describe, it, expect } from 'vitest';
import { compileFormula, FormulaError } from '../formula.js';

// A fake table definition matching the registry shape, covering every wire
// type the translator must handle. `registry` supplies link-target lookups.
const registry = {
  Patients: { pgTable: 'patients', fields: { id: { column: 'id', pg: 'text', wire: 'text' } } },
  Referrals: { pgTable: 'referrals', fields: { id: { column: 'id', pg: 'text', wire: 'text' } } },
};

const T = {
  pgTable: 'authorizations',
  registry,
  fields: {
    id:                { column: 'id', pg: 'text', wire: 'text' },
    referral_id:       { column: 'referral_id', pg: 'text', wire: 'text' },
    patient_id:        { column: 'patient_id', pg: 'text', wire: 'linkArray', linkTable: 'Patients' },
    ref_link:          { column: 'ref_link', pg: 'text', wire: 'linkArray', linkTable: 'Referrals' },
    updated_at:        { column: 'updated_at', pg: 'timestamptz', wire: 'timestamp' },
    is_active:         { column: 'is_active', pg: 'boolean', wire: 'checkbox' },
    amount:            { column: 'amount', pg: 'bigint', wire: 'int' },
    services:          { column: 'services', pg: 'text[]', wire: 'textArray' },
    name:              { column: 'name', pg: 'text', wire: 'text' },
  },
};

describe('formula translator — the 7 core app patterns', () => {
  it('#1 equality, double quotes', () => {
    const { sql, params } = compileFormula('{referral_id} = "ref_123"', T);
    expect(sql).toBe('"referral_id"::text = $1');
    expect(params).toEqual(['ref_123']);
  });

  it('#2 equality, single quotes (episodes.js)', () => {
    const { sql, params } = compileFormula(`{referral_id} = 'ref_9'`, T);
    expect(sql).toBe('"referral_id"::text = $1');
    expect(params).toEqual(['ref_9']);
  });

  it('#3 FIND + ARRAYJOIN on a link field resolves both rec ids and business ids', () => {
    const { sql, params } = compileFormula('FIND("pat_007", ARRAYJOIN({patient_id}))', T);
    expect(sql).toBe('("patient_id" = $1 OR "patient_id" IN (SELECT rec_id FROM "patients" WHERE id = $1))');
    expect(params).toEqual(['pat_007']);
  });

  it('#4 OR of two FINDs (eligibilityVerifications legacy/canonical)', () => {
    const { sql } = compileFormula(
      'OR(FIND("recABC", ARRAYJOIN({patient_id})), FIND("recABC", ARRAYJOIN({ref_link})))', T);
    expect(sql).toMatch(/OR/);
    expect(sql).toContain('"patient_id"');
    expect(sql).toContain('"ref_link"');
  });

  it('#5 OR of equalities → parameterized IN-equivalent', () => {
    const { sql, params } = compileFormula('OR({id} = "a", {id} = "b", {id} = "c")', T);
    expect(sql).toBe('("id"::text = $1 OR "id"::text = $2 OR "id"::text = $3)');
    expect(params).toEqual(['a', 'b', 'c']);
  });

  it('#7 IS_AFTER for incremental sync', () => {
    const { sql, params } = compileFormula(`IS_AFTER({updated_at}, '2026-07-01T00:00:00.000Z')`, T);
    expect(sql).toBe('"updated_at" > $1::timestamptz');
    expect(params).toEqual(['2026-07-01T00:00:00.000Z']);
  });
});

describe('formula translator — report-engine operators', () => {
  it('neq', () => {
    const { sql } = compileFormula('{name} != "x"', T);
    expect(sql).toBe('("name" IS NULL OR "name"::text <> $1)');
  });
  it('contains via SEARCH(...) > 0', () => {
    const { sql, params } = compileFormula('SEARCH("smith", {name}) > 0', T);
    expect(sql).toContain('ILIKE');
    expect(params).toEqual(['smith']);
  });
  it('is_empty / not_empty', () => {
    expect(compileFormula('{name} = ""', T).sql).toBe(`("name" IS NULL OR "name"::text = '')`);
    expect(compileFormula('NOT({name} = "")', T).sql).toBe(`NOT (("name" IS NULL OR "name"::text = ''))`);
  });
  it('checkbox true/false', () => {
    expect(compileFormula('{is_active} = 1', T).sql).toBe('"is_active" IS TRUE');
    expect(compileFormula('OR({is_active} = 0, {is_active} = "")', T).sql)
      .toContain('"is_active" IS NOT TRUE');
  });
  it('before/after/between composition', () => {
    const { sql } = compileFormula(
      `AND(IS_AFTER({updated_at}, "2026-01-01"), IS_BEFORE({updated_at}, "2026-02-01"))`, T);
    expect(sql).toBe('("updated_at" > $1::timestamptz AND "updated_at" < $2::timestamptz)');
  });
  it('numeric comparisons', () => {
    expect(compileFormula('{amount} > 5', T).sql).toBe('"amount" > $1::numeric');
    expect(compileFormula('{amount} <= 10', T).sql).toBe('"amount" <= $1::numeric');
  });
});

describe('formula translator — safety', () => {
  it('rejects unknown fields (whitelist)', () => {
    expect(() => compileFormula('{evil_col} = "x"', T)).toThrow(FormulaError);
  });
  it('rejects unsupported functions loudly', () => {
    expect(() => compileFormula('REGEX_MATCH({name}, "x")', T)).toThrow(FormulaError);
  });
  it('never interpolates values into SQL', () => {
    const { sql } = compileFormula(`{name} = "'; DROP TABLE patients; --"`, T);
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).toBe('"name"::text = $1');
  });
  it('FIND on multipleSelects array column', () => {
    const { sql, params } = compileFormula('FIND("PT", ARRAYJOIN({services}))', T);
    expect(sql).toBe('$1 = ANY("services")');
    expect(params).toEqual(['PT']);
  });
});

describe('formula translator — Support app patterns (found at cutover)', () => {
  it('RECORD_ID() equality → rec_id match', () => {
    const { sql, params } = compileFormula(`RECORD_ID() = 'rec123'`, T);
    expect(sql).toBe('"rec_id" = $1');
    expect(params).toEqual(['rec123']);
  });
  it('OR of RECORD_ID()s (user resolution)', () => {
    const { sql } = compileFormula(`OR(RECORD_ID() = 'recA', RECORD_ID() = 'recB')`, T);
    expect(sql).toBe('("rec_id" = $1 OR "rec_id" = $2)');
  });
  it('SEARCH + ARRAYJOIN on a link field behaves like FIND (ticket children)', () => {
    const { sql, params } = compileFormula(`OR(SEARCH('recT1', ARRAYJOIN({patient_id})))`, T);
    expect(sql).toBe('(("patient_id" = $1 OR "patient_id" IN (SELECT rec_id FROM "patients" WHERE id = $1)))');
    expect(params).toEqual(['recT1']);
  });
  it('SEARCH with LOWER(literal) needle and LOWER({field}) hay', () => {
    const { sql, params } = compileFormula(`SEARCH(LOWER('JoHn'), LOWER({name}))`, T);
    expect(sql).toContain('ILIKE');
    expect(params).toEqual(['john']);
  });
});

describe('formula translator — field-support supervisor lookup patterns', () => {
  it('LOWER equality', () => {
    const { sql, params } = compileFormula(`LOWER({name}) = 'a@b.com'`, T);
    expect(sql).toBe(`LOWER("name"::text)::text = $1`);
    expect(params).toEqual(['a@b.com']);
  });
  it('SEARCH over LOWER field (bare predicate inside OR)', () => {
    const { sql, params } = compileFormula(`OR(SEARCH('jo', LOWER({name})), LOWER({name}) = 'x')`, T);
    expect(sql).toContain('ILIKE');
    expect(params[0]).toBe('jo');
  });
  it('AND of checkbox equalities (field categories)', () => {
    const { sql } = compileFormula('AND({is_active}=1,{is_active}=1)', T);
    expect(sql).toBe('("is_active" IS TRUE AND "is_active" IS TRUE)');
  });
});
