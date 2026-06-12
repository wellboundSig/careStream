/**
 * Guardrail: stage transitions must go through the engine.
 *
 * The whole point of the transition engine is to be the SINGLE place a
 * referral's `current_stage` changes. This test is a tripwire: it scans
 * production source for `current_stage:` and fails if it appears anywhere
 * outside the engine — except a small, documented allowlist.
 *
 * If this test fails because you added a new transition: route it through
 * `attemptTransition` + `applyTransition` instead of writing `current_stage`
 * directly. If you added a legitimate non-write usage (reading the field into
 * an export/display object) add the file to ALLOWLIST with a reason.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', '..'); // .../careStream/src

// Directories that are allowed to reference current_stage freely.
const EXEMPT_DIR_SEGMENTS = ['__tests__', `${'engine'}/`, '/test/', 'data/'];

// Files allowed to contain `current_stage:` for documented, non-transition
// reasons (creation, or reading the field into a display/export object).
const ALLOWLIST = {
  'components/forms/NewReferralForm.jsx': 'Sets the INITIAL stage on referral creation (not a transition).',
  'components/modules/StagePanel.jsx': 'Reads current_stage into an Excel export row.',
  'pages/PatientList.jsx': 'Builds a display row object for the context menu (read).',
  'pages/DataTools.jsx': 'Reads current_stage into an export row.',
  'components/tasks/TaskCard.jsx': 'Builds a placeholder referral object for display (current_stage: "").',
  'test/factories.js': 'Test factory default + docstring.',
};

function listSourceFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe('guardrail: no direct current_stage writes outside the engine', () => {
  it('current_stage only appears in the engine or the documented allowlist', () => {
    const offenders = [];
    for (const file of listSourceFiles(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/');
      if (EXEMPT_DIR_SEGMENTS.some((seg) => `/${rel}`.includes(seg))) continue;
      const text = readFileSync(file, 'utf-8');
      if (!text.includes('current_stage:')) continue;
      if (ALLOWLIST[rel]) continue;
      offenders.push(rel);
    }
    expect(
      offenders,
      `These files write/reference current_stage outside the engine. Route transitions through ` +
      `attemptTransition + applyTransition, or add a documented entry to ALLOWLIST:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });
});
