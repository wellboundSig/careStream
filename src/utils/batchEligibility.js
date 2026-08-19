/**
 * Spreadsheet → planned Optum (and later Waystar / eSolutions) checks.
 * Empty IDs are skipped. Unknown commercial payers are marked unsupported
 * until another clearinghouse is wired in.
 */

import { guessPayerIdFromInsurance } from '../api/optumEligibility.js';

export const BATCH_COLUMNS = Object.freeze({
  name: ['patient name', 'name', 'patient'],
  ssn: ['ssn', 'social', 'social security'],
  residentType: ['resident type', 'res type', 'setting', 'division'],
  gender: ['gender', 'sex'],
  dob: ['dob', 'date of birth', 'birth date', 'birthdate'],
  doa: ['doa', 'date of admission', 'admission', 'admit date'],
  medicaidId: ['medicaid id', 'medicaid', 'medicaid #', 'cin'],
  medicareId: ['medicare id', 'medicare', 'medicare #', 'mbi', 'hicn'],
  otherInsurance: ['other insurance', 'other ins', 'commercial', 'other payer', 'secondary'],
  skillNeed: ['skill need', 'skilled need', 'skill', 'needs'],
});

export const ELIGIBILITY_NETWORKS = Object.freeze({
  optum: { id: 'optum', label: 'Optum', supported: true },
  waystar: { id: 'waystar', label: 'Waystar', supported: false },
  esolutions: { id: 'esolutions', label: 'eSolutions', supported: false },
});

function normHeader(h) {
  return String(h || '').replace(/\u00a0/g, ' ').replace(/[_]+/g, ' ').trim().toLowerCase();
}

export function mapSpreadsheetHeaders(headers) {
  const map = {};
  const unused = [];
  for (const raw of headers || []) {
    const n = normHeader(raw);
    if (!n) continue;
    let hit = null;
    for (const [key, aliases] of Object.entries(BATCH_COLUMNS)) {
      if (aliases.some((a) => n === a || n.startsWith(`${a} `))) {
        hit = key;
        break;
      }
    }
    if (hit && map[hit] == null) map[hit] = raw;
    else unused.push(raw);
  }
  return { map, unused };
}

export function splitPersonName(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return { firstName: '', lastName: '' };
  if (s.includes(',')) {
    const [last, rest = ''] = s.split(',').map((x) => x.trim());
    const parts = rest.split(' ').filter(Boolean);
    return { firstName: parts[0] || '', lastName: last };
  }
  const parts = s.split(' ').filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function parseFlexibleDate(raw) {
  if (raw == null || raw === '') return '';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000);
    const y = utc.getUTCFullYear();
    const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
    const d = String(utc.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(raw).trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (us) {
    let y = Number(us[3]);
    if (y < 100) y += y >= 30 ? 1900 : 2000;
    return `${y}-${String(us[1]).padStart(2, '0')}-${String(us[2]).padStart(2, '0')}`;
  }
  return '';
}

export function parseOtherInsurance(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return { name: '', memberId: '' };
  const split = s.match(/^(.+?)\s*[/|:]\s*([A-Za-z0-9-]{5,})$/);
  if (split) return { name: split[1].trim(), memberId: split[2] };
  const parts = s.split(' ');
  const last = parts[parts.length - 1];
  if (parts.length >= 2 && /^[A-Za-z0-9-]{6,}$/.test(last) && /\d/.test(last)) {
    return { name: parts.slice(0, -1).join(' '), memberId: last };
  }
  return { name: s, memberId: '' };
}

export function todayYyyymmdd(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function dateToYyyymmdd(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}${m[2]}${m[3]}` : '';
}

export function parseSpreadsheetRows(headers, dataRows) {
  const { map } = mapSpreadsheetHeaders(headers);
  return (dataRows || []).map((cells, i) => {
    const get = (key) => {
      const header = map[key];
      if (header == null) return '';
      const idx = headers.indexOf(header);
      if (idx < 0) return '';
      const v = cells[idx];
      if (v == null) return '';
      if (v instanceof Date) return v;
      if (typeof v === 'object' && v.text) return v.text;
      if (typeof v === 'object' && v.result != null) return v.result;
      if (typeof v === 'object' && Array.isArray(v.richText)) {
        return v.richText.map((t) => t.text).join('');
      }
      return v;
    };
    const nameRaw = String(get('name') || '').trim();
    const { firstName, lastName } = splitPersonName(nameRaw);
    const other = parseOtherInsurance(get('otherInsurance'));
    const dob = parseFlexibleDate(get('dob'));
    const doa = parseFlexibleDate(get('doa'));
    return {
      rowNumber: i + 2,
      nameRaw,
      firstName,
      lastName,
      ssn: String(get('ssn') || '').trim(),
      residentType: String(get('residentType') || '').trim(),
      gender: String(get('gender') || '').trim(),
      dob,
      doa,
      medicaidId: String(get('medicaidId') || '').replace(/\s+/g, '').trim(),
      medicareId: String(get('medicareId') || '').replace(/\s+/g, '').trim(),
      otherInsuranceName: other.name,
      otherInsuranceMemberId: other.memberId,
      skillNeed: String(get('skillNeed') || '').trim(),
    };
  }).filter((r) => r.nameRaw || r.dob || r.medicaidId || r.medicareId || r.otherInsuranceName);
}

function skipCheck(key, label, reason) {
  return {
    key,
    label,
    status: 'skipped',
    network: null,
    payerId: '',
    memberId: '',
    reason,
  };
}

export function planRowChecks(row) {
  const missingBase = [];
  if (!row.firstName || !row.lastName) missingBase.push('patient first and last name');
  if (!row.dob) missingBase.push('DOB');
  const dateOfService = dateToYyyymmdd(row.doa) || todayYyyymmdd();

  const checks = [];

  if (!row.medicareId) {
    checks.push(skipCheck('medicare', 'Medicare', 'Medicare ID empty'));
  } else if (missingBase.length) {
    checks.push(skipCheck('medicare', 'Medicare', missingBase.join(', ')));
  } else {
    checks.push({
      key: 'medicare',
      label: 'Medicare',
      status: 'queued',
      network: 'optum',
      payerId: 'CMS',
      memberId: row.medicareId,
      category: 'medicare',
      payerName: 'Medicare',
      dateOfService,
    });
  }

  if (!row.medicaidId) {
    checks.push(skipCheck('medicaid', 'Medicaid', 'Medicaid ID empty'));
  } else if (missingBase.length) {
    checks.push(skipCheck('medicaid', 'Medicaid', missingBase.join(', ')));
  } else {
    checks.push({
      key: 'medicaid',
      label: 'Medicaid',
      status: 'queued',
      network: 'optum',
      payerId: 'MCDNY',
      memberId: row.medicaidId,
      category: 'medicaid',
      payerName: 'NY Medicaid',
      dateOfService,
    });
  }

  if (!row.otherInsuranceName) {
    checks.push(skipCheck('other', 'Other insurance', 'Other Insurance empty'));
  } else {
    const payerId = guessPayerIdFromInsurance({
      payer_display_name: row.otherInsuranceName,
      insurance_category: 'commercial',
    });
    if (!payerId) {
      checks.push({
        key: 'other',
        label: 'Other insurance',
        status: 'unsupported',
        network: null,
        payerId: '',
        memberId: row.otherInsuranceMemberId || '',
        reason: `No Optum payer ID for “${row.otherInsuranceName}” — will run when Waystar / eSolutions is connected`,
      });
    } else if (!row.otherInsuranceMemberId) {
      checks.push(skipCheck('other', 'Other insurance', `“${row.otherInsuranceName}” mapped to Optum ${payerId}, but no member ID on that column`));
    } else if (missingBase.length) {
      checks.push(skipCheck('other', 'Other insurance', missingBase.join(', ')));
    } else {
      checks.push({
        key: 'other',
        label: 'Other insurance',
        status: 'queued',
        network: 'optum',
        payerId,
        memberId: row.otherInsuranceMemberId,
        category: 'commercial',
        payerName: row.otherInsuranceName,
        dateOfService,
      });
    }
  }

  return checks;
}

export function summarizeOptumResult(data) {
  const s = data?.summary || {};
  const usable = !!data?.ok && !s.enrollmentBlock && (s.benefitCount > 0 || s.activeCoverage || s.inactiveCoverage);
  return {
    status: s.suggestedStatus || (data?.ok ? 'unable_to_verify' : 'error'),
    usable,
    plan: s.planLabel || s.payerName || '',
    active: !!s.activeCoverage,
    inactive: !!s.inactiveCoverage,
    enrollmentBlock: !!s.enrollmentBlock,
    plainEnglish: s.plainEnglish || data?.error || '',
    error: data?.error || s.error || '',
  };
}

export function formatCheckOutcome(check) {
  if (!check) return { result: '', detail: '' };
  if (check.status === 'skipped' || check.status === 'unsupported') {
    return { result: check.status === 'unsupported' ? 'Unsupported payer' : 'Skipped', detail: check.reason || '' };
  }
  if (check.status === 'error') {
    return { result: 'Error', detail: check.error || check.reason || '' };
  }
  if (check.status === 'queued' || check.status === 'running') {
    return { result: check.status, detail: '' };
  }
  const sum = check.summary || {};
  return {
    result: sum.status || check.status || '',
    detail: [sum.plan, sum.plainEnglish || sum.error].filter(Boolean).join(' — '),
  };
}

export function buildExportRows(rows) {
  return rows.map((row) => {
    const byKey = Object.fromEntries((row.checks || []).map((c) => [c.key, c]));
    const med = formatCheckOutcome(byKey.medicare);
    const mcd = formatCheckOutcome(byKey.medicaid);
    const oth = formatCheckOutcome(byKey.other);
    const ran = (row.checks || []).filter((c) => c.status === 'done' || c.status === 'error');
    const usable = ran.filter((c) => c.summary?.usable).length;
    return {
      'Patient Name': row.nameRaw,
      SSN: row.ssn,
      'Resident Type': row.residentType,
      Gender: row.gender,
      DOB: row.dob,
      DOA: row.doa,
      'Medicaid ID': row.medicaidId,
      'Medicare ID': row.medicareId,
      'Other Insurance': row.otherInsuranceName,
      'Skill Need': row.skillNeed,
      'Medicare result': med.result,
      'Medicare detail': med.detail,
      'Medicaid result': mcd.result,
      'Medicaid detail': mcd.detail,
      'Other insurance result': oth.result,
      'Other insurance detail': oth.detail,
      'Checks run': ran.length,
      'Usable results': usable,
    };
  });
}

export async function parseUploadedSpreadsheet(file) {
  const name = String(file?.name || '').toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return parseCsvText(new TextDecoder().decode(buf));
  }
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('The workbook has no sheets.');
  const headers = [];
  const dataRows = [];
  sheet.eachRow((row, rowNumber) => {
    const values = [];
    const max = Math.max(row.cellCount, headers.length || 0, 16);
    for (let c = 1; c <= max; c += 1) values.push(row.getCell(c).value);
    if (rowNumber === 1) {
      headers.push(...values.map((v) => (v == null ? '' : String(typeof v === 'object' && v.text ? v.text : v).trim())));
    } else {
      dataRows.push(values);
    }
  });
  if (!headers.some(Boolean)) throw new Error('Could not read a header row.');
  return parseSpreadsheetRows(headers, dataRows);
}

export function parseCsvText(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('The file is empty.');
  const rows = lines.map(splitCsvLine);
  const headers = rows[0].map((h) => String(h || '').trim());
  return parseSpreadsheetRows(headers, rows.slice(1));
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i += 1; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export async function workbookFromExportRows(rows) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Eligibility results');
  const cols = rows[0] ? Object.keys(rows[0]) : ['Patient Name'];
  ws.columns = cols.map((h) => ({ header: h, key: h, width: Math.min(36, Math.max(14, h.length + 2)) }));
  for (const row of rows) ws.addRow(row);
  ws.getRow(1).font = { bold: true };
  return wb;
}

export async function downloadWorkbook(wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function runQueuedChecks(rows, {
  runCheck,
  concurrency = 2,
  delayMs = 400,
  onProgress,
} = {}) {
  const jobs = [];
  for (const row of rows) {
    for (const check of row.checks || []) {
      if (check.status === 'queued') jobs.push({ row, check });
    }
  }
  let cursor = 0;
  let finished = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const idx = cursor;
      cursor += 1;
      const job = jobs[idx];
      job.check.status = 'running';
      onProgress?.({ done: finished, total: jobs.length, running: job });
      try {
        const data = await runCheck(job.row, job.check);
        job.check.status = 'done';
        job.check.summary = summarizeOptumResult(data);
      } catch (err) {
        job.check.status = 'error';
        job.check.error = err?.message || 'Check failed';
        job.check.summary = {
          status: 'error',
          usable: false,
          error: job.check.error,
          plainEnglish: job.check.error,
        };
      }
      finished += 1;
      onProgress?.({ done: finished, total: jobs.length });
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  const n = Math.min(Math.max(1, concurrency), jobs.length || 1);
  if (jobs.length) await Promise.all(Array.from({ length: n }, () => worker()));
  return rows;
}

export function maskSsn(ssn) {
  const d = String(ssn || '').replace(/\D/g, '');
  if (d.length < 4) return ssn ? '•••' : '';
  return `•••-••-${d.slice(-4)}`;
}
