/**
 * db.js — thin RDS Data API helper for wellbound-api.
 *
 * All values travel as string/boolean parameters and are cast in SQL
 * (the Data API has no reliable array/jsonb input type for PostgreSQL).
 */

import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

const client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';

/**
 * Execute SQL with positional params ($1..$n). Params may be
 * string | number | boolean | null. Returns rows as plain objects
 * (Data API JSON formatting).
 */
export async function query(sql, params = []) {
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

  // Data API uses :name params — rewrite $N → :N.
  const namedSql = sql.replace(/\$(\d+)/g, ':$1');

  const res = await client.send(new ExecuteStatementCommand({
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
