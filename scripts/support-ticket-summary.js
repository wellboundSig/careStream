#!/usr/bin/env node
/**
 * One-shot support ticket summary → Excel on Desktop.
 *
 *   node scripts/support-ticket-summary.js
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import ExcelJS from 'exceljs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envPath = resolve(__dirname, '..', '.env');
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* no .env */ }
}
loadEnv();

const API_URL = (process.env.WB_API_URL || process.env.VITE_API_URL || '').replace(/\/$/, '');
const INTERNAL_KEY = process.env.WB_INTERNAL_KEY || '';
if (!API_URL || !INTERNAL_KEY) {
  console.error('Need WB_API_URL + WB_INTERNAL_KEY in .env');
  process.exit(1);
}

const DATA = `${API_URL}/internal`;
const HEADERS = { 'x-internal-key': INTERNAL_KEY, 'x-internal-caller': 'support-ticket-summary' };

async function fetchAll(table) {
  const records = [];
  let offset = null;
  do {
    const url = new URL(`${DATA}/${encodeURIComponent(table)}`);
    if (offset) url.searchParams.set('offset', offset);
    url.searchParams.set('pageSize', '100');
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`Fetch ${table} failed ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const r of data.records) records.push({ _id: r.id, ...r.fields });
    offset = data.offset || null;
  } while (offset);
  return records;
}

function firstLink(v) {
  if (Array.isArray(v) && v.length) return v[0];
  return v || null;
}

function personName(u) {
  if (!u) return 'Unknown';
  if (u.name) return String(u.name).trim() || 'Unknown';
  const n = `${u.first_name || ''} ${u.last_name || ''}`.trim();
  return n || u.email || 'Unknown';
}

function topN(countMap, n) {
  return [...countMap.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n);
}

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D1B3D' } };
    cell.alignment = { vertical: 'middle' };
  });
}

async function main() {
  console.log('Fetching Tickets, Users, Categories, Clinicians…');
  const [tickets, users, categories, clinicians] = await Promise.all([
    fetchAll('Tickets'),
    fetchAll('Users'),
    fetchAll('Categories'),
    fetchAll('Clinicians').catch(() => []),
  ]);

  const userById = new Map();
  for (const u of users) {
    userById.set(u._id, u);
    if (u.id) userById.set(u.id, u);
  }
  const clinById = new Map();
  for (const c of clinicians) {
    clinById.set(c._id, c);
    if (c.id) clinById.set(c.id, c);
  }
  const catById = new Map();
  for (const c of categories) {
    catById.set(c._id, c);
    if (c.id) catById.set(c.id, c);
  }

  const createdBy = new Map();
  const topics = new Map();
  const resolvedBy = new Map();

  for (const t of tickets) {
    const isField = (t.source || 'clerk') === 'field';
    const creatorId = isField ? firstLink(t.clinician_id) : firstLink(t.requester_id);
    const creator = isField
      ? personName(clinById.get(creatorId))
      : personName(userById.get(creatorId));
    const creatorKey = creatorId ? `${creator}` : creator;
    createdBy.set(creatorKey, (createdBy.get(creatorKey) || 0) + 1);

    const catId = firstLink(t.category_id);
    const topic = catById.get(catId)?.name || 'Uncategorized';
    topics.set(topic, (topics.get(topic) || 0) + 1);

    if (String(t.status || '') === 'Resolved') {
      const rid = firstLink(t.resolved_by_id);
      if (rid) {
        const name = personName(userById.get(rid));
        resolvedBy.set(name, (resolvedBy.get(name) || 0) + 1);
      }
    }
  }

  const topCreators = topN(createdBy, 5);
  const topTopics = topN(topics, 3);
  const topResolvers = topN(resolvedBy, 2);

  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = resolve(homedir(), 'Desktop', `Support_Ticket_Summary_${stamp}.xlsx`);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'CareStream';
  wb.created = new Date();

  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'Section', key: 'section', width: 28 },
    { header: 'Rank', key: 'rank', width: 8 },
    { header: 'Name / Topic', key: 'name', width: 36 },
    { header: 'Count', key: 'count', width: 12 },
  ];
  styleHeader(summary.getRow(1));

  let row = 2;
  topCreators.forEach(([name, count], i) => {
    summary.getRow(row++).values = ['Top ticket creators', i + 1, name, count];
  });
  row++;
  topTopics.forEach(([name, count], i) => {
    summary.getRow(row++).values = ['Top topics', i + 1, name, count];
  });
  row++;
  topResolvers.forEach(([name, count], i) => {
    summary.getRow(row++).values = ['Top IT resolvers (Resolved)', i + 1, name, count];
  });

  summary.getRow(row + 1).values = ['Total tickets scanned', '', '', tickets.length];
  summary.getRow(row + 2).values = ['Resolved tickets with resolver', '', '', [...resolvedBy.values()].reduce((a, b) => a + b, 0)];
  summary.getRow(row + 3).values = ['Report generated', '', '', new Date().toLocaleString()];

  const creatorsSheet = wb.addWorksheet('Top 5 Creators');
  creatorsSheet.columns = [
    { header: 'Rank', key: 'rank', width: 8 },
    { header: 'User', key: 'name', width: 36 },
    { header: 'Tickets created', key: 'count', width: 18 },
  ];
  styleHeader(creatorsSheet.getRow(1));
  topCreators.forEach(([name, count], i) => {
    creatorsSheet.addRow({ rank: i + 1, name, count });
  });

  const topicsSheet = wb.addWorksheet('Top 3 Topics');
  topicsSheet.columns = [
    { header: 'Rank', key: 'rank', width: 8 },
    { header: 'Topic', key: 'name', width: 40 },
    { header: 'Tickets', key: 'count', width: 12 },
  ];
  styleHeader(topicsSheet.getRow(1));
  topTopics.forEach(([name, count], i) => {
    topicsSheet.addRow({ rank: i + 1, name, count });
  });

  const resolversSheet = wb.addWorksheet('Top 2 IT Resolvers');
  resolversSheet.columns = [
    { header: 'Rank', key: 'rank', width: 8 },
    { header: 'IT staff', key: 'name', width: 36 },
    { header: 'Tickets resolved', key: 'count', width: 18 },
  ];
  styleHeader(resolversSheet.getRow(1));
  topResolvers.forEach(([name, count], i) => {
    resolversSheet.addRow({ rank: i + 1, name, count });
  });

  await wb.xlsx.writeFile(outPath);

  console.log('\n=== Support ticket summary ===');
  console.log(`Tickets scanned: ${tickets.length}`);
  console.log('\nTop 5 creators:');
  topCreators.forEach(([n, c], i) => console.log(`  ${i + 1}. ${n} — ${c}`));
  console.log('\nTop 3 topics:');
  topTopics.forEach(([n, c], i) => console.log(`  ${i + 1}. ${n} — ${c}`));
  console.log('\nTop 2 IT resolvers:');
  topResolvers.forEach(([n, c], i) => console.log(`  ${i + 1}. ${n} — ${c}`));
  console.log(`\nExcel written:\n  ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
