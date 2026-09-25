/**
 * Physician NPI / PECOS verification PDF — an ePACES-style verification
 * report built from the verification data stored on the physician record
 * (npi_status, npi_details, PECOS / OPRA enrollment, Order & Referring
 * flags, and when the check was run).
 *
 * Used two ways:
 *   - appended as a page of the EMR packet (generateEmrPacket.js), so SPN
 *     intake no longer screenshots ePACES / NPI registry for clinical review
 *   - downloaded / printed individually from the patient snapshot's
 *     Physician tab
 */
import { jsPDF } from 'jspdf';

const INK = {
  headerBg: [30, 41, 59],
  headerFg: [255, 255, 255],
  section: [30, 41, 59],
  label: [100, 116, 139],
  value: [15, 23, 42],
  muted: [100, 116, 139],
  rule: [226, 232, 240],
  good: [5, 150, 105],
  bad: [220, 38, 38],
  warn: [217, 119, 6],
};

const fmt = (v) => (v != null && v !== '' ? String(v) : '—');

function parseJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

/** "sole_proprietor" → "Sole Proprietor" */
function prettyKey(key) {
  return String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

const FLAG_LABELS = {
  PARTB: 'Medicare Part B',
  DME: 'DME (Durable Medical Equipment)',
  HHA: 'HHA (Home Health Agency)',
  HOSPICE: 'Hospice',
  PMD: 'PMD (Power Mobility Devices)',
};

/**
 * Build the verification report as PDF bytes (ArrayBuffer).
 * @param {object} opts
 * @param {object} opts.physician    physician record (store shape)
 * @param {object} [opts.patient]    optional patient for chart context
 * @param {object} [opts.referral]   optional referral for chart context
 * @param {string} [opts.checkedByName]  display name of who ran the check
 */
export function buildPhysicianVerificationPdfBytes({ physician, patient = null, referral = null, checkedByName = '' }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageW = 215.9;
  const pageH = 279.4;
  const marginL = 18;
  const marginR = 18;
  const contentW = pageW - marginL - marginR;
  let y = 0;

  function paintHeader() {
    doc.setFillColor(...INK.headerBg);
    doc.rect(0, 0, pageW, 14, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...INK.headerFg);
    doc.text('WELLBOUND CARESTREAM', marginL, 9);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text('Provider NPI / PECOS Verification', pageW - marginR, 9, { align: 'right' });
    y = 22;
  }

  function paintFooter() {
    doc.setDrawColor(...INK.rule);
    doc.line(marginL, pageH - 14, pageW - marginR, pageH - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...INK.muted);
    doc.text(
      'Sources: NPPES NPI Registry (v2.1) and CMS Order & Referring (PECOS) dataset  ·  Confidential — for clinical review use.',
      pageW / 2, pageH - 9, { align: 'center' },
    );
  }

  function ensureSpace(needed = 12) {
    if (y + needed > pageH - 20) {
      paintFooter();
      doc.addPage();
      paintHeader();
    }
  }

  function sectionHeader(label) {
    ensureSpace(12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...INK.section);
    doc.text(label.toUpperCase(), marginL, y + 3);
    y += 5;
    doc.setDrawColor(...INK.headerBg);
    doc.setLineWidth(0.4);
    doc.line(marginL, y, pageW - marginR, y);
    doc.setLineWidth(0.2);
    y += 6;
  }

  function row(label, value, { color = INK.value, bold = false } = {}) {
    ensureSpace(8);
    const colBreak = 58;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...INK.label);
    doc.text(label, marginL, y);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(fmt(value), contentW - colBreak);
    doc.text(lines, marginL + colBreak, y);
    y += Math.max(5.5, lines.length * 4.2);
  }

  function gap(n = 4) { y += n; }

  paintHeader();

  const physName = `${physician?.title ? `${physician.title} ` : ''}${physician?.first_name || ''} ${physician?.last_name || ''}`.trim() || '—';
  const ranAt = physician?.verification_last_run_at || physician?.npi_checked_at || null;
  const details = parseJson(physician?.npi_details);
  const flags = parseJson(physician?.order_refer_flags);

  // ── Verification run ────────────────────────────────────────────────────
  sectionHeader('Verification');
  row('Date verification ran', ranAt ? fmtDateTime(ranAt) : 'No verification on record', {
    color: ranAt ? INK.value : INK.bad,
    bold: !ranAt,
  });
  if (checkedByName) row('Checked by', checkedByName);
  row('Report generated', fmtDateTime(new Date().toISOString()));
  gap();

  // ── Chart context ───────────────────────────────────────────────────────
  if (patient || referral) {
    sectionHeader('Patient Context');
    if (patient) row('Patient', `${patient.first_name || ''} ${patient.last_name || ''}`.trim());
    if (referral?.id) row('Referral ID', referral.id);
    if (referral?.division) row('Division', referral.division);
    gap();
  }

  // ── Provider ────────────────────────────────────────────────────────────
  sectionHeader('Provider');
  row('Name', physName);
  row('NPI', physician?.npi);
  if (physician?.phone) row('Phone', physician.phone);
  if (physician?.fax) row('Fax', physician.fax);
  const address = [physician?.address_street, physician?.address_city, physician?.address_state, physician?.address_zip]
    .filter(Boolean).join(', ');
  if (address) row('Address', address);
  gap();

  // ── NPI registry (NPPES) ────────────────────────────────────────────────
  sectionHeader('NPI Registry (NPPES)');
  const npiStatus = physician?.npi_status || null;
  row('NPI status', npiStatus ? npiStatus.replace(/_/g, ' ').toUpperCase() : 'Not checked', {
    color: npiStatus === 'active' ? INK.good : npiStatus ? INK.bad : INK.warn,
    bold: true,
  });
  row('Provider name on record', physician?.npi_provider_name);
  if (physician?.npi_checked_at) row('NPI checked at', fmtDateTime(physician.npi_checked_at));
  // Every stored field from the registry return, no filtering.
  if (details && typeof details === 'object') {
    for (const [key, value] of Object.entries(details)) {
      const v = (value != null && typeof value === 'object') ? JSON.stringify(value) : value;
      row(prettyKey(key), v);
    }
  }
  gap();

  // ── PECOS ───────────────────────────────────────────────────────────────
  sectionHeader('PECOS (Medicare Order & Referring Enrollment)');
  const pecos = physician?.is_pecos_enrolled;
  row('PECOS enrolled', pecos === true || pecos === 'true' ? 'YES — enrolled' : (physician?.pecos_last_checked ? 'NO — not found in Order & Referring dataset' : 'Not checked'), {
    color: pecos === true || pecos === 'true' ? INK.good : (physician?.pecos_last_checked ? INK.bad : INK.warn),
    bold: true,
  });
  if (physician?.pecos_last_checked) row('PECOS checked at', fmtDateTime(physician.pecos_last_checked));
  gap();

  // ── OPRA ────────────────────────────────────────────────────────────────
  sectionHeader('OPRA Eligibility');
  const opra = physician?.is_opra_enrolled;
  row('OPRA eligible', opra === true || opra === 'true' ? 'YES' : (physician?.opra_last_checked ? 'NO' : 'Not checked'), {
    color: opra === true || opra === 'true' ? INK.good : (physician?.opra_last_checked ? INK.bad : INK.warn),
    bold: true,
  });
  if (physician?.opra_last_checked) row('OPRA checked at', fmtDateTime(physician.opra_last_checked));
  gap();

  // ── Order & Referring privileges ────────────────────────────────────────
  if (flags && typeof flags === 'object' && Object.keys(flags).length > 0) {
    sectionHeader('Order & Referring Privileges');
    for (const [key, value] of Object.entries(flags)) {
      const on = value === true || value === 'true' || value === 'Y';
      row(FLAG_LABELS[key] || prettyKey(key), on ? 'YES' : 'NO', {
        color: on ? INK.good : INK.bad,
        bold: true,
      });
    }
  }

  paintFooter();
  return doc.output('arraybuffer');
}

function fileBaseName(physician) {
  const last = (physician?.last_name || 'Physician').replace(/[^\w-]+/g, '');
  const first = (physician?.first_name || '').replace(/[^\w-]+/g, '');
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${last}${first ? `_${first}` : ''}_NPI_Verification_${date}`;
}

/** Trigger a browser download of the verification report. */
export function downloadPhysicianVerificationPdf(opts) {
  const bytes = buildPhysicianVerificationPdfBytes(opts);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${fileBaseName(opts.physician)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Open the report in a new tab (browser PDF viewer) ready to print/save. */
export function printPhysicianVerificationPdf(opts) {
  const bytes = buildPhysicianVerificationPdfBytes(opts);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
