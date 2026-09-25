#!/usr/bin/env node
/**
 * Generate the Marketer Performance workbook from LIVE Aurora data, using the
 * exact same rules as the in-app report (src/utils/marketerPerformance.js):
 *
 *   - credit → originally assigned marketer (original_marketer_id)
 *   - close rate = SOC ÷ (SOC + NTUC), resolved referrals only
 *   - SOC bucketed by soc_completed_date, NTUC by ntuc_date (outcome dating)
 *   - open referrals shown as a current snapshot, excluded from the rate
 *   - Discarded Leads excluded entirely
 *
 * Usage:
 *   node scripts/generate-marketer-report-from-db.mjs [outPath]
 *     --period qtd|lastq|ytd|all     (default qtd = this quarter to date)
 *
 * Requires WB_CLUSTER_ARN + WB_SECRET_ARN (loads careStream/.env).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const name of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(resolve(__dirname, '..', name), 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* missing */ }
}

const periodIdx = process.argv.indexOf('--period');
const PERIOD = periodIdx >= 0 ? process.argv[periodIdx + 1] : 'qtd';
const outArg = process.argv.slice(2).filter((a, i) => a !== '--period' && process.argv[periodIdx + 1] !== a || (i + 2) !== periodIdx + 1);

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';
const client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });

async function query(sql) {
  const res = await client.send(new ExecuteStatementCommand({
    resourceArn, secretArn, database, sql, includeResultMetadata: true,
  }));
  const cols = (res.columnMetadata || []).map((c) => c.name);
  return (res.records || []).map((row) => {
    const o = {};
    row.forEach((c, i) => { o[cols[i]] = (!c || c.isNull) ? null : (c.stringValue ?? c.longValue ?? c.booleanValue ?? c.doubleValue ?? null); });
    return o;
  });
}

// ── Period bounds (calendar quarters, local time) ────────────────────────────
function periodBounds(id) {
  const now = new Date();
  if (id === 'all') return { fromTs: null, toTs: null, label: 'All time' };
  if (id === 'ytd') return { fromTs: new Date(now.getFullYear(), 0, 1).getTime(), toTs: null, label: `YTD ${now.getFullYear()}` };
  const qNow = Math.floor(now.getMonth() / 3);
  const q = id === 'lastq' ? qNow - 1 : qNow;
  const start = new Date(now.getFullYear(), q * 3, 1);
  const end = new Date(now.getFullYear(), (q + 1) * 3, 1).getTime() - 1;
  const qLabel = `Q${((q % 4) + 4) % 4 + 1} ${start.getFullYear()}`;
  return {
    fromTs: start.getTime(),
    toTs: id === 'lastq' ? end : null,
    label: id === 'lastq' ? qLabel : `${qLabel} (to date)`,
  };
}

// ── Metric rules — mirror src/utils/marketerPerformance.js exactly ───────────
const isDiscarded = (r) => r.current_stage === 'Discarded Leads';
const isNtuc = (r) => r.current_stage === 'NTUC';
function isSocCompleted(r) {
  if (isNtuc(r) || isDiscarded(r)) return false;
  if (r.current_stage === 'SOC Completed') return true;
  return r.soc_completed_date != null && r.soc_completed_date !== '';
}
const isOpen = (r) => !isDiscarded(r) && !isNtuc(r) && !isSocCompleted(r);
const attributionId = (r) => String(r.original_marketer_id || '').trim() || String(r.marketer_id || '').trim();

function toTs(v) {
  if (!v) return null;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}
function inBounds(v, b) {
  if (b.fromTs == null && b.toTs == null) return true;
  const ts = toTs(v);
  if (ts == null) return false;
  if (b.fromTs != null && ts < b.fromTs) return false;
  if (b.toTs != null && ts > b.toTs) return false;
  return true;
}

const METHODOLOGY =
  'Close rate = SOC ÷ (SOC + NTUC), counted by outcome date. Open referrals are '
  + 'excluded from the rate and shown separately. Credit belongs to the originally '
  + 'assigned marketer; reassignments do not move credit. Discarded leads are excluded.';

const COUNTS_NOTE =
  'Note: these columns measure different windows and are not meant to add up. '
  + 'Referrals Received counts by referral date, SOC and NTUC count by the date '
  + 'the outcome happened, and Open is a live snapshot that ignores the period. '
  + 'A marketer can show more SOCs than new referrals in a quarter when older '
  + 'referrals converted during that quarter. This is expected.';

const bounds = periodBounds(PERIOD);

const marketers = await query('SELECT id, first_name, last_name, region, division, status FROM marketers ORDER BY last_name');
const referrals = await query(`
  SELECT original_marketer_id, marketer_id, current_stage, patient_id, division,
         ntuc_reason,
         referral_date::text AS referral_date,
         soc_scheduled_date::text AS soc_scheduled_date,
         soc_completed_date::text AS soc_completed_date,
         admitted_date::text AS admitted_date,
         ntuc_date::text AS ntuc_date
  FROM referrals
`);
const patientRows = await query('SELECT id, first_name, last_name FROM patients');
const patientName = {};
for (const p of patientRows) {
  patientName[p.id] = `${p.first_name || ''} ${p.last_name || ''}`.trim();
}

const groups = {};
for (const r of referrals) {
  if (isDiscarded(r)) continue;
  const mid = attributionId(r) || '__unassigned__';
  const g = (groups[mid] ||= { received: 0, soc: 0, ntuc: 0, open: 0 });
  if (inBounds(r.referral_date, bounds)) g.received += 1;
  if (isSocCompleted(r) && inBounds(r.soc_completed_date, bounds)) g.soc += 1;
  if (isNtuc(r) && inBounds(r.ntuc_date, bounds)) g.ntuc += 1;
  if (isOpen(r)) g.open += 1;
}

const ROWS = [];
for (const m of marketers) {
  const g = groups[String(m.id).trim()] || { received: 0, soc: 0, ntuc: 0, open: 0 };
  const closed = g.soc + g.ntuc;
  ROWS.push({
    marketer: `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.id,
    region: m.region || 'N/A',
    division: m.division || 'N/A',
    received: g.received, soc: g.soc, ntuc: g.ntuc, closed,
    closeRate: closed ? `${Math.round((g.soc / closed) * 100)}%` : 'N/A',
    open: g.open,
  });
}
// Real, resolvable marketers only; referrals with no valid marketer are
// excluded from this report entirely.
const knownIds = new Set(marketers.map((m) => String(m.id).trim()));
ROWS.sort((a, b) => b.soc - a.soc || b.received - a.received);

const totals = ROWS.reduce((a, r) => ({
  received: a.received + r.received, soc: a.soc + r.soc,
  ntuc: a.ntuc + r.ntuc, open: a.open + r.open,
}), { received: 0, soc: 0, ntuc: 0, open: 0 });
const totalClosed = totals.soc + totals.ntuc;

// ── Workbook ─────────────────────────────────────────────────────────────────
const BRAND = { magenta: 'C41E6A', dark: '1A1A2E', muted: '6B7280', headerFg: 'FFFFFF' };
const wb = new ExcelJS.Workbook();
wb.creator = 'Wellbound CareStream';
wb.created = new Date();

const s = wb.addWorksheet('Summary', { properties: { tabColor: { argb: BRAND.magenta } } });
s.mergeCells('A1:F1');
s.getCell('A1').value = 'Marketer Performance';
s.getCell('A1').font = { name: 'Calibri', size: 20, bold: true, color: { argb: BRAND.dark } };
s.getRow(1).height = 28;
s.mergeCells('A2:F2');
s.getCell('A2').value = 'Wellbound CareStream';
s.getCell('A2').font = { name: 'Calibri', size: 11, bold: true, color: { argb: BRAND.magenta } };
s.mergeCells('A3:F3');
s.getCell('A3').value = `Period: ${bounds.label} · Generated ${new Date().toLocaleString()} · Live production data`;
s.getCell('A3').font = { name: 'Calibri', size: 10, color: { argb: BRAND.muted } };
s.mergeCells('A4:H4');
s.getCell('A4').value = `${METHODOLOGY}\n${COUNTS_NOTE}`;
s.getCell('A4').font = { name: 'Calibri', size: 9.5, italic: true, color: { argb: BRAND.muted } };
s.getCell('A4').alignment = { wrapText: true, vertical: 'top' };
s.getRow(4).height = 96;

let row = 6;
s.getCell(`A${row}`).value = 'Key metrics';
s.getCell(`A${row}`).font = { name: 'Calibri', size: 12, bold: true, color: { argb: BRAND.dark } };
row += 1;
for (const [label, value] of [
  ['Marketers', ROWS.length],
  ['Referrals received', totals.received],
  ['SOC (in period)', totals.soc],
  ['NTUC (in period)', totals.ntuc],
  ['Overall close rate', totalClosed ? `${Math.round((totals.soc / totalClosed) * 100)}%` : 'N/A'],
  ['Open (excluded from rate)', totals.open],
]) {
  s.getCell(`A${row}`).value = label;
  s.getCell(`A${row}`).font = { name: 'Calibri', size: 10, color: { argb: BRAND.muted } };
  s.getCell(`B${row}`).value = value;
  s.getCell(`B${row}`).font = { name: 'Calibri', size: 14, bold: true, color: { argb: BRAND.dark } };
  row += 1;
}
s.getColumn(1).width = 30;
s.getColumn(2).width = 18;

const d = wb.addWorksheet('Detail');
const columns = [
  { key: 'marketer',  header: 'Marketer',            width: 22 },
  { key: 'region',    header: 'Region',              width: 14 },
  { key: 'division',  header: 'Division',            width: 15 },
  { key: 'received',  header: 'Referrals Received',  width: 18 },
  { key: 'soc',       header: 'SOC (by SOC date)',   width: 18 },
  { key: 'ntuc',      header: 'NTUC (by NTUC date)', width: 20 },
  { key: 'closed',    header: 'Closed (SOC + NTUC)', width: 20 },
  { key: 'closeRate', header: 'Close Rate',          width: 12 },
  { key: 'open',      header: 'Open (current)',      width: 15 },
];
d.columns = columns.map((c) => ({ key: c.key, width: c.width }));
const hr = d.addRow(columns.map((c) => c.header));
hr.eachCell((cell) => {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.magenta } };
  cell.font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: BRAND.headerFg } };
});
d.getRow(1).height = 20;
for (const r of ROWS) d.addRow(columns.map((c) => r[c.key]));
d.eachRow((r, i) => {
  if (i === 1) return;
  if (i % 2 === 1) r.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8F5F7' } }; });
});
d.views = [{ state: 'frozen', ySplit: 1 }];

// ── One tab per marketer: their patients + referral detail ───────────────────
const fmtDate = (v) => (v ? String(v).slice(0, 10) : '');
const yesNo = (v) => (v ? 'Yes' : 'No');
const statusOf = (r) => (isNtuc(r) ? 'NTUC' : isSocCompleted(r) ? 'SOC Completed' : 'Open');

const byMarketer = {};
for (const r of referrals) {
  if (isDiscarded(r)) continue;
  const mid = attributionId(r);
  if (!mid || !knownIds.has(mid)) continue; // excluded entirely
  (byMarketer[mid] ||= []).push(r);
}

const sheetColumns = [
  { key: 'patient',        header: 'Patient',             width: 24 },
  { key: 'referral_date',  header: 'Referral/Lead Added', width: 18 },
  { key: 'division',       header: 'Division',            width: 14 },
  { key: 'stage',          header: 'Current Stage',       width: 24 },
  { key: 'status',         header: 'Status',              width: 15 },
  { key: 'soc_scheduled',  header: 'SOC Scheduled',       width: 14 },
  { key: 'scheduled_date', header: 'SOC Scheduled Date',  width: 18 },
  { key: 'soc_done',       header: 'SOC Completed',       width: 14 },
  { key: 'soc_date',       header: 'SOC Date',            width: 14 },
  { key: 'ntuc_date',      header: 'NTUC Date',           width: 14 },
  { key: 'ntuc_reason',    header: 'NTUC Reason',         width: 26 },
];

const usedNames = new Set(['Summary', 'Detail']);
const sheetTargets = marketers.map((m) => ({
  id: String(m.id).trim(),
  label: `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.id,
}));
for (const m of sheetTargets) {
  const refs = byMarketer[m.id];
  if (!refs?.length) continue;
  let name = m.label.slice(0, 28);
  let n = 2;
  while (usedNames.has(name)) name = `${name.slice(0, 24)} (${n++})`;
  usedNames.add(name);

  const ws = wb.addWorksheet(name.replace(/[:\\/?*[\]]/g, ''));
  ws.columns = sheetColumns.map((c) => ({ key: c.key, width: c.width }));
  const h = ws.addRow(sheetColumns.map((c) => c.header));
  h.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.magenta } };
    cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: BRAND.headerFg } };
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  refs
    .slice()
    .sort((a, b) => new Date(b.referral_date || 0) - new Date(a.referral_date || 0))
    .forEach((r) => {
      ws.addRow(sheetColumns.map((c) => ({
        patient:        patientName[r.patient_id] || r.patient_id || 'Unknown',
        referral_date:  fmtDate(r.referral_date),
        division:       r.division || '',
        stage:          r.current_stage || '',
        status:         statusOf(r),
        soc_scheduled:  yesNo(r.soc_scheduled_date),
        scheduled_date: fmtDate(r.soc_scheduled_date),
        soc_done:       yesNo(isSocCompleted(r)),
        soc_date:       fmtDate(r.soc_completed_date || r.admitted_date),
        ntuc_date:      fmtDate(r.ntuc_date),
        ntuc_reason:    isNtuc(r) ? (r.ntuc_reason || '') : '',
      })[c.key]));
    });
}

const OUT = (outArg.length && !outArg[0].startsWith('--'))
  ? outArg[0]
  : resolve(process.cwd(), '..', `Marketer Performance - ${bounds.label.replace(/[/\\]/g, '-')}.xlsx`);
await wb.xlsx.writeFile(OUT);
console.log(`Wrote ${OUT}`);
console.table(ROWS);
