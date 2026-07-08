/**
 * db.js — query layer for wellbound-api with two interchangeable drivers:
 *
 *   NATIVE PG (WB_PG_HOST set) — direct connection to Aurora from inside the
 *     VPC. ~5-15ms per query vs the Data API's ~50-80ms HTTP overhead. One
 *     pooled connection per warm container (RDS Proxy is unnecessary at this
 *     concurrency and costs ~$90/mo minimum). Credentials come from the
 *     cluster's Secrets Manager secret, fetched once per container.
 *
 *   RDS DATA API (fallback) — the original driver; no VPC required. Rollback
 *     = unset WB_PG_HOST on the Lambda and it's back instantly.
 *
 * Both drivers return identical shapes: { rows, numberOfRecordsUpdated } with
 * rows as plain objects. pg type parsers are overridden so temporal/numeric
 * values arrive as the same strings/numbers the Data API produced — the wire
 * format (records.js) is driver-agnostic.
 */

import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

const PG_HOST = process.env.WB_PG_HOST || '';
const database = process.env.WB_DATABASE || 'wellbound';
const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;

// ── Native pg driver ──────────────────────────────────────────────────────────

let pgPoolPromise = null;

async function getPgPool() {
  if (pgPoolPromise) return pgPoolPromise;
  pgPoolPromise = (async () => {
    const [{ default: pg }, { SecretsManagerClient, GetSecretValueCommand }] = await Promise.all([
      import('pg'),
      import('@aws-sdk/client-secrets-manager'),
    ]);

    const sm = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-2' });
    const secret = await sm.send(new GetSecretValueCommand({ SecretId: secretArn }));
    const { username, password } = JSON.parse(secret.SecretString);

    // Match the Data API's JSON text shapes so records.js needs no changes:
    // temporal types stay strings, int8/numeric become numbers.
    pg.types.setTypeParser(1184, (v) => v);            // timestamptz
    pg.types.setTypeParser(1114, (v) => v);            // timestamp
    pg.types.setTypeParser(1082, (v) => v);            // date
    pg.types.setTypeParser(20, (v) => Number(v));      // int8
    pg.types.setTypeParser(1700, (v) => Number(v));    // numeric

    const pool = new pg.Pool({
      host: PG_HOST,
      port: Number(process.env.WB_PG_PORT || 5432),
      database,
      user: username,
      password,
      max: 2,                       // per container; total connections stay tiny
      idleTimeoutMillis: 120_000,
      connectionTimeoutMillis: 5_000,
      // Aurora enforces TLS (force_ssl). Traffic never leaves the VPC, so the
      // platform-default cert without CA pinning is acceptable here.
      ssl: { rejectUnauthorized: false },
    });
    pool.on('error', (err) => console.error('[pg] idle client error:', err.message));
    return pool;
  })();
  pgPoolPromise.catch(() => { pgPoolPromise = null; }); // retry on next call
  return pgPoolPromise;
}

async function queryPg(sql, params) {
  const pool = await getPgPool();
  const res = await pool.query(sql, params.map((v) => (v === undefined ? null : v)));
  return { rows: res.rows, numberOfRecordsUpdated: res.rowCount ?? 0 };
}

// ── RDS Data API driver (fallback) ───────────────────────────────────────────

const dataClient = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });

async function queryDataApi(sql, params) {
  const parameters = params.map((v, i) => {
    const name = String(i + 1);
    if (v === null || v === undefined) return { name, value: { isNull: true } };
    if (typeof v === 'boolean') return { name, value: { booleanValue: v } };
    if (typeof v === 'number') {
      return Number.isInteger(v)
        ? { name, value: { longValue: v } }
        : { name, value: { doubleValue: v } };
    }
    return { name, value: { stringValue: String(v) } };
  });

  const namedSql = sql.replace(/\$(\d+)/g, ':$1');

  const res = await dataClient.send(new ExecuteStatementCommand({
    resourceArn,
    secretArn,
    database,
    sql: namedSql,
    parameters,
    formatRecordsAs: 'JSON',
  }));

  return {
    rows: res.formattedRecords ? JSON.parse(res.formattedRecords) : [],
    numberOfRecordsUpdated: res.numberOfRecordsUpdated ?? 0,
  };
}

// ── Public interface ──────────────────────────────────────────────────────────

/**
 * Execute SQL with positional params ($1..$n). Params may be
 * string | number | boolean | null.
 */
export async function query(sql, params = []) {
  return PG_HOST ? queryPg(sql, params) : queryDataApi(sql, params);
}
