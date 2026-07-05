#!/usr/bin/env node
/**
 * migrate.js — apply db/migrations/*.sql to Aurora via the RDS Data API.
 *
 * DDL lives in the repo; this runner applies pending migrations in filename
 * order and records them in `schema_migrations`. No hand-typed SQL in the
 * console (per migration plan Phase 1).
 *
 * Env (run from CloudShell or any AWS-credentialed shell in acct 493042495477):
 *   WB_CLUSTER_ARN   arn:aws:rds:us-east-2:493042495477:cluster:wellbound-prod
 *   WB_SECRET_ARN    arn:aws:secretsmanager:...  (cluster master user secret)
 *   WB_DATABASE      target database (default: wellbound; use wellbound_staging first)
 *
 * Usage:
 *   node db/migrate.js            # apply pending
 *   node db/migrate.js --status   # list applied vs pending
 *
 * Requires: npm i -D @aws-sdk/client-rds-data
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';

if (!resourceArn || !secretArn) {
  console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN (see header comment).');
  process.exit(1);
}

const client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });

async function exec(sql) {
  return client.send(new ExecuteStatementCommand({ resourceArn, secretArn, database, sql }));
}

/** Split a migration file into statements the Data API can run one at a time.
 *  Respects $$-quoted function bodies (our trigger functions). */
function splitStatements(sqlText) {
  const statements = [];
  let buf = '';
  let inDollar = false;
  for (const line of sqlText.split('\n')) {
    const dollarCount = (line.match(/\$\$/g) || []).length;
    buf += line + '\n';
    if (dollarCount % 2 === 1) inDollar = !inDollar;
    if (!inDollar && /;\s*$/.test(line)) {
      // Strip leading comment lines (table banners) but keep the statement.
      const stmt = buf.replace(/^(\s*--[^\n]*\n)+/g, '').trim();
      if (stmt) statements.push(stmt);
      buf = '';
    }
  }
  const tail = buf.replace(/^(\s*--[^\n]*\n)+/g, '').trim();
  if (tail) statements.push(tail);
  return statements;
}

async function main() {
  await exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz DEFAULT now()
  )`);

  const appliedRes = await exec('SELECT filename FROM schema_migrations ORDER BY filename');
  const applied = new Set((appliedRes.records || []).map((r) => r[0].stringValue));

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const pending = files.filter((f) => !applied.has(f));

  if (process.argv.includes('--status')) {
    for (const f of files) console.log(`${applied.has(f) ? 'applied' : 'PENDING'}  ${f}`);
    return;
  }

  if (pending.length === 0) {
    console.log('Up to date — no pending migrations.');
    return;
  }

  for (const file of pending) {
    console.log(`Applying ${file} …`);
    const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const statements = splitStatements(sqlText);
    for (let i = 0; i < statements.length; i++) {
      try {
        await exec(statements[i]);
      } catch (err) {
        console.error(`  FAILED at statement ${i + 1}/${statements.length}:\n${statements[i].slice(0, 300)}`);
        throw err;
      }
    }
    await exec(`INSERT INTO schema_migrations (filename) VALUES ('${file.replace(/'/g, "''")}')`);
    console.log(`  ✓ ${statements.length} statements`);
  }
  console.log(`Done — ${pending.length} migration(s) applied to ${database}.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
