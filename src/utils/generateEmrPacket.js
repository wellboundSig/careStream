import { jsPDF } from 'jspdf';
import { getPhysician } from '../api/physicians.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt     = (v)  => (v != null && v !== '') ? String(v) : '—';
const fmtBool = (v)  => (v === true || v === 'true') ? 'Yes' : (v === false || v === 'false') ? 'No' : '—';
const fmtDate = (v)  => {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

// ── PDF builder ───────────────────────────────────────────────────────────────
export async function generateEmrPacket(referral, resolveSource) {
  const p   = referral.patient || {};
  const isSN  = referral.division === 'Special Needs';
  const isALF = referral.division === 'ALF';

  // Fetch physician record on demand
  let physician = null;
  if (referral.physician_id) {
    try {
      const rec = await getPhysician(referral.physician_id);
      physician = rec.fields || rec;
    } catch { /* leave null */ }
  }

  const sourceName = resolveSource ? resolveSource(referral.referral_source_id) : '—';

  // ── Document setup ──────────────────────────────────────────────────────────
  const doc       = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageW     = 215.9;
  const pageH     = 279.4;
  const marginL   = 20;
  const marginR   = 20;
  const contentW  = pageW - marginL - marginR;
  const colBreak  = 58; // label column width
  let y = 0;

  // ── Header band ─────────────────────────────────────────────────────────────
  doc.setFillColor(196, 30, 110);
  doc.rect(0, 0, pageW, 16, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  doc.text('WELLBOUND CARESTREAM', marginL, 10.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('EMR Onboarding Packet', pageW - marginR, 10.5, { align: 'right' });

  y = 24;

  // Sub-header row
  doc.setFontSize(8);
  doc.setTextColor(107, 114, 128);
  doc.text(`Generated: ${fmtDate(new Date())}`, marginL, y);
  doc.text(
    `SOC Date: ${fmtDate(referral.soc_scheduled_date)}`,
    pageW - marginR, y, { align: 'right' }
  );
  y += 5;

  doc.setDrawColor(229, 231, 235);
  doc.line(marginL, y, pageW - marginR, y);
  y += 7;

  // ── Layout helpers (closures over doc / y) ──────────────────────────────────
  function sectionHeader(title) {
    // tinted band
    doc.setFillColor(252, 245, 249);
    doc.rect(marginL, y - 1.5, contentW, 8, 'F');
    doc.setDrawColor(234, 179, 208);
    doc.line(marginL, y + 6.5, pageW - marginR, y + 6.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(196, 30, 110);
    doc.text(title.toUpperCase(), marginL + 3, y + 4.5);
    y += 11;
  }

  function row(label, value) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text(label, marginL + 3, y);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(26, 26, 46);
    doc.text(fmt(value), marginL + 3 + colBreak, y);
    y += 6;
  }

  function gap(n = 5) { y += n; }

  // ── 1. Basic Info ────────────────────────────────────────────────────────────
  sectionHeader('Basic Info');
  row('Branch(es)',         isSN ? 'S01, S02, WSI' : isALF ? 'A01, WA1' : '—');
  row('Patient Last Name',  p.last_name);
  row('Patient First Name', p.first_name);
  gap();

  // ── 2. Demographics ──────────────────────────────────────────────────────────
  sectionHeader('Demographics');
  row('Gender',        p.gender);
  row('Date of Birth', fmtDate(p.dob));
  row('Phone',         p.phone_primary);
  if (p.phone_secondary) row('Phone (Alt)', p.phone_secondary);
  if (p.address_street) {
    const addr = [p.address_street, p.address_city].filter(Boolean).join(', ');
    row('Address', addr);
  }
  gap();

  // ── 3. Referral Source ───────────────────────────────────────────────────────
  sectionHeader('Referral Source');
  row('Referral Date',      fmtDate(referral.referral_date));
  row('Referral Source',    sourceName);
  if (physician) {
    const physName = `${physician.first_name || ''} ${physician.last_name || ''}`.trim();
    row('Referring Physician', physName || '—');
  } else {
    row('Referring Physician', '—');
  }
  gap();

  // ── 4. Services Requested ────────────────────────────────────────────────────
  sectionHeader('Services Requested');
  const services = Array.isArray(referral.services_requested)
    ? referral.services_requested.join(', ')
    : (referral.services_requested || '—');
  row('Services', services);
  gap();

  // ── 5. Insurance ─────────────────────────────────────────────────────────────
  sectionHeader('Insurance');
  row('Medicare Number',    p.medicare_number);
  row('Medicaid Number',    p.medicaid_number);
  row('Insurance Plan',     p.insurance_plan);
  row('Member / Insurance ID', p.insurance_id);
  gap();

  // ── 6. Physician ─────────────────────────────────────────────────────────────
  sectionHeader('Physician');
  if (physician) {
    const physName = `${physician.first_name || ''} ${physician.last_name || ''}`.trim();
    row('Name',  physName);
    row('NPI',   physician.npi);
    row('Phone', physician.phone);
  } else {
    row('Physician', '—');
  }
  gap();

  // ── 7. Emergency Contact ──────────────────────────────────────────────────────
  sectionHeader('Emergency Contact');
  row('Name',  p.emergency_contact_name);
  row('Phone', p.emergency_contact_phone);
  row('Email', p.emergency_contact_email);

  // ── Footer ───────────────────────────────────────────────────────────────────
  doc.setDrawColor(229, 231, 235);
  doc.line(marginL, pageH - 16, pageW - marginR, pageH - 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(156, 163, 175);
  doc.text(
    'Wellbound CareStream  ·  Confidential — for internal EMR onboarding use only.',
    pageW / 2, pageH - 10, { align: 'center' }
  );

  // ── Save ─────────────────────────────────────────────────────────────────────
  const lastName  = (p.last_name  || 'Patient').replace(/\s+/g, '_');
  const firstName = (p.first_name || '').replace(/\s+/g, '_');
  const dateStr   = new Date().toISOString().split('T')[0];
  doc.save(`EMR_Onboarding_${lastName}_${firstName}_${dateStr}.pdf`);
}
