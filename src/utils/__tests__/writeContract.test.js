import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const registry = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../db/registry.json'),
    'utf8',
  ),
);

/** Fields the UI actually POSTs. If generate-ddl wipes one, creates 422. */
const WRITE_CONTRACTS = {
  Notes: ['id', 'patient_id', 'referral_id', 'author_id', 'content', 'created_at', 'updated_at', 'is_pinned'],
  Notifications: [
    'id', 'recipient_user_id', 'actor_user_id', 'type', 'entity_type', 'entity_id',
    'patient_id', 'referral_id', 'title', 'body', 'is_read', 'created_at', 'updated_at',
  ],
  Patients: ['insurance_plans', 'insurance_plan_details', 'insurance_plan'],
  PatientGuardians: ['id', 'patient_id', 'guardian_id', 'relationship', 'is_primary', 'is_emergency', 'source', 'created_at', 'updated_at'],
  Referrals: ['account_manager_info'],
};

describe('write contract vs registry', () => {
  for (const [table, fields] of Object.entries(WRITE_CONTRACTS)) {
    it(`${table} still has every field the client writes`, () => {
      expect(registry[table], table).toBeTruthy();
      for (const f of fields) {
        expect(registry[table].fields[f], `${table}.${f}`).toBeTruthy();
      }
    });
  }

  it('Notes.content is text (not jsonb) so freeform notes can be posted', () => {
    expect(registry.Notes.fields.content.wire).toBe('text');
  });
});
