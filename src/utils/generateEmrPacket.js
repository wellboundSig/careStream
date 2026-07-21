import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { getPhysician } from '../api/physicians.js';
import { getFilesByPatient } from '../api/patientFiles.js';
import { getNotesByPatient } from '../api/notes.js';
import { getStageHistory } from '../api/stageHistory.js';
import { getConflictsByReferral } from '../api/conflicts.js';
import { getTriageAdult, getTriagePediatric } from '../api/triage.js';
import { getSignedFileUrl } from './r2Upload.js';
import { conflictCategoryLabel, normalizeSeverity } from './conflictFlagging.js';

// Neutral print palette — clean, readable, no brand pink washes.
const INK = {
  headerBg: [30, 41, 59],       // slate
  headerFg: [255, 255, 255],
  section: [30, 41, 59],
  label: [100, 116, 139],
  value: [15, 23, 42],
  muted: [100, 116, 139],
  rule: [226, 232, 240],
  body: [30, 41, 59],
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v) => (v != null && v !== '') ? String(v) : '—';
const fmtDate = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

const fmtDateTime = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' · '
    + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

function fmtCalendarDate(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function humanizeUserIds(text, resolveUser) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\busr_[A-Za-z0-9_-]+\b/g, (id) => {
    const name = resolveUser?.(id);
    return name && name !== '—' ? name : id;
  });
}

function resolveName(id, resolveUser, resolveMarketer) {
  if (!id) return null;
  const u = resolveUser?.(id);
  if (u && u !== '—') return u;
  const m = resolveMarketer?.(id);
  if (m && m !== '—') return m;
  return id;
}

function safeFilePart(value, fallback = 'Patient') {
  return String(value || fallback)
    .trim()
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    || fallback;
}

function patientNameParts(patient = {}) {
  const last = safeFilePart(patient.last_name, 'Patient');
  const first = safeFilePart(patient.first_name, '');
  return { last, first };
}

function uniqueZipName(used, rawName) {
  const base = safeFilePart(rawName || 'file', 'file');
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  let candidate = `${stem}${ext}`;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${stem}_${n}${ext}`;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function downloadBlob(bytes, filename, mime = 'application/pdf') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function fetchFileBytes(file) {
  const url = await getSignedFileUrl(file, { download: true });
  if (!url) throw new Error('No signed URL');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

// ── jsPDF section document builder ────────────────────────────────────────────

function createSectionDoc(title) {
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
    doc.text(title, pageW - marginR, 9, { align: 'right' });
    y = 22;
  }

  function paintFooter() {
    doc.setDrawColor(...INK.rule);
    doc.line(marginL, pageH - 14, pageW - marginR, pageH - 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...INK.muted);
    doc.text(
      'Wellbound CareStream  ·  Confidential — for internal EMR onboarding use only.',
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

  function row(label, value) {
    ensureSpace(8);
    const colBreak = 52;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...INK.label);
    doc.text(label, marginL, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK.value);
    const lines = doc.splitTextToSize(fmt(value), contentW - colBreak);
    doc.text(lines, marginL + colBreak, y);
    y += Math.max(5.5, lines.length * 4.2);
  }

  function bodyText(text, { bold = false, size = 9, color = INK.body } = {}) {
    const lines = doc.splitTextToSize(String(text || ''), contentW);
    for (const line of lines) {
      ensureSpace(6);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...color);
      doc.text(line, marginL, y);
      y += size * 0.42 + 1.4;
    }
  }

  function gap(n = 4) { y += n; }

  paintHeader();

  return {
    doc, pageW, pageH, marginL, marginR, contentW,
    get y() { return y; },
    set y(v) { y = v; },
    paintHeader, paintFooter, ensureSpace, sectionHeader, row, bodyText, gap,
  };
}

// ── Cover / demographics sheet ────────────────────────────────────────────────

async function buildCoverPdf(referral, resolveSource, { fileCount = 0 } = {}) {
  const p = referral.patient || {};
  const isSN = referral.division === 'Special Needs';
  const isALF = referral.division === 'ALF';

  let physician = null;
  if (referral.physician_id) {
    try {
      const rec = await getPhysician(referral.physician_id);
      physician = rec.fields || rec;
    } catch { /* leave null */ }
  }

  const sourceName = resolveSource ? resolveSource(referral.referral_source_id) : '—';
  const s = createSectionDoc('EMR Onboarding Packet');

  const patientName = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Patient';
  s.doc.setFont('helvetica', 'bold');
  s.doc.setFontSize(14);
  s.doc.setTextColor(...INK.value);
  s.doc.text(patientName, s.marginL, s.y);
  s.y += 6;

  s.doc.setFont('helvetica', 'normal');
  s.doc.setFontSize(8);
  s.doc.setTextColor(...INK.muted);
  s.doc.text(`Generated ${fmtDate(new Date())}`, s.marginL, s.y);
  s.doc.text(`SOC: ${fmtDate(referral.soc_scheduled_date)}`, s.pageW - s.marginR, s.y, { align: 'right' });
  s.y += 4;
  s.doc.setDrawColor(...INK.rule);
  s.doc.line(s.marginL, s.y, s.pageW - s.marginR, s.y);
  s.y += 6;

  if (fileCount > 0) {
    s.bodyText(
      `${fileCount} patient file${fileCount === 1 ? '' : 's'} are included separately in this ZIP download (folder: Patient_Files).`,
      { size: 8, color: INK.muted },
    );
    s.gap(3);
  }

  s.sectionHeader('Basic Info');
  s.row('Division', referral.division || '—');
  s.row('Branch(es)', isSN ? 'S01, S02, WSI' : isALF ? 'A01, WA1' : '—');
  s.row('Patient Last Name', p.last_name);
  s.row('Patient First Name', p.first_name);
  s.gap();

  s.sectionHeader('Demographics');
  s.row('Gender', p.gender);
  s.row('Date of Birth', fmtDate(p.dob));
  s.row('Phone', p.phone_primary);
  if (p.phone_secondary) s.row('Phone (Alt)', p.phone_secondary);
  if (p.address_street || p.address_city) {
    s.row('Address', [p.address_street, p.address_city, p.address_state, p.address_zip].filter(Boolean).join(', '));
  }
  s.gap();

  s.sectionHeader('Referral Source');
  s.row('Referral Date', fmtDate(referral.referral_date));
  s.row('Referral Source', sourceName);
  if (physician) {
    const physName = `${physician.first_name || ''} ${physician.last_name || ''}`.trim();
    s.row('Referring Physician', physName || '—');
  } else {
    s.row('Referring Physician', '—');
  }
  s.gap();

  s.sectionHeader('Services Requested');
  const services = Array.isArray(referral.services_requested)
    ? referral.services_requested.join(', ')
    : (referral.services_requested || '—');
  s.row('Services', services);
  s.gap();

  s.sectionHeader('Insurance');
  s.row('Medicare Number', p.medicare_number);
  s.row('Medicaid Number', p.medicaid_number);
  s.row('Insurance Plan', p.insurance_plan);
  s.row('Member / Insurance ID', p.insurance_id);
  s.gap();

  s.sectionHeader('Physician');
  if (physician) {
    const physName = `${physician.first_name || ''} ${physician.last_name || ''}`.trim();
    s.row('Name', physName);
    s.row('NPI', physician.npi);
    s.row('Phone', physician.phone);
  } else {
    s.row('Physician', '—');
  }
  s.gap();

  s.sectionHeader('Emergency Contact');
  s.row('Name', p.emergency_contact_name);
  s.row('Phone', p.emergency_contact_phone);
  s.row('Email', p.emergency_contact_email);

  if (fileCount > 0) {
    s.gap();
    s.sectionHeader('Patient Files in This ZIP');
    s.bodyText('See the Patient_Files folder for original uploads.', { size: 8, color: INK.muted });
  }

  s.paintFooter();
  return s.doc.output('arraybuffer');
}

// ── Notes pages ───────────────────────────────────────────────────────────────

function buildNotesPdf(notes, resolveUser) {
  const s = createSectionDoc('Patient Notes');
  s.sectionHeader('All Patient Notes');
  s.bodyText(
    notes.length
      ? `${notes.length} note${notes.length === 1 ? '' : 's'} · newest first`
      : 'No patient notes on file.',
    { size: 8, color: INK.muted },
  );
  s.gap(3);

  if (!notes.length) {
    s.paintFooter();
    return s.doc.output('arraybuffer');
  }

  for (const n of notes) {
    s.ensureSpace(18);
    const author = resolveName(n.author_id, resolveUser) || 'Unknown';
    const when = fmtDateTime(n.created_at);
    s.bodyText(`${when}  ·  ${author}`, { bold: true, size: 8, color: INK.label });
    s.gap(1);
    const content = humanizeUserIds(n.content || '(empty note)', resolveUser);
    s.bodyText(content, { size: 9 });
    s.gap(2);
    s.doc.setDrawColor(...INK.rule);
    s.doc.line(s.marginL, s.y, s.pageW - s.marginR, s.y);
    s.gap(4);
  }

  s.paintFooter();
  return s.doc.output('arraybuffer');
}

// ── Timeline pages ────────────────────────────────────────────────────────────

function referralMilestones(referral) {
  if (!referral) return [];
  const r = referral;
  const out = [];
  const push = (id, ts, title, detail, actor) => {
    if (!ts) return;
    out.push({ _id: id, type: 'milestone', timestamp: ts, title, detail: detail || null, actor: actor || null });
  };

  push('ms-clin-pushed', r.clinical_review_pushed_at, 'Pushed to Clinical RN Review', null, null);

  if (r.clinical_review_completed_at) {
    const decision = (r.clinical_review_decision || '').toLowerCase();
    const decLabel = decision === 'accept' ? 'Accepted'
      : decision === 'conditional' ? 'Accepted (conditional)'
      : decision ? decision.charAt(0).toUpperCase() + decision.slice(1)
      : null;
    push('ms-clin-done', r.clinical_review_completed_at, 'Clinical RN review completed',
      decLabel ? `Decision: ${decLabel}` : null,
      r.clinical_review_completed_by_id || r.clinical_review_by || null);
  }

  push('ms-elig-done', r.eligibility_completed_at, 'Eligibility completed', null, r.eligibility_completed_by_id || null);
  push('ms-auth-obtained', r.auth_obtained_at, 'Authorization obtained', null, r.auth_obtained_by_id || null);
  push('ms-emr-initial', r.emr_initial_onboarded_at, 'Initial EMR onboarding completed', 'HCHB chart created during Intake', r.emr_initial_onboarded_by_id || null);
  push('ms-emr', r.emr_onboarded_at, 'EMR onboarding completed', null, r.emr_onboarded_by_id || null);
  push('ms-staffing', r.staffing_confirmed_at, 'Staffing confirmed — clinician matched', 'Sent to Pre-SOC', r.staffing_confirmed_by_id || null);
  push('ms-soc-sched', r.soc_scheduled_at || r.soc_scheduled_date, 'SOC scheduled',
    r.soc_scheduled_date ? `SOC date: ${fmtCalendarDate(r.soc_scheduled_date)}` : null,
    r.soc_scheduled_by_id || null);
  push('ms-soc-done', r.soc_completed_date, 'SOC completed', null, null);

  if (r.recent_hospitalization === true || r.recent_hospitalization === 'true') {
    push('ms-hosp', r.hospitalization_date, 'Recent hospitalization',
      r.hospitalization_date ? `Hospitalized ${fmtCalendarDate(r.hospitalization_date)}` : null, null);
  }

  return out;
}

function parseStageTransitionNote(content) {
  if (!content) return null;
  const m = content.match(/^\[([^\]]+?)\s*(?:→|->)\s*([^\]]+?)\]\s*\n?([\s\S]*)$/);
  if (!m) return null;
  return { fromStage: m[1].trim(), toStage: m[2].trim(), body: (m[3] || '').trim() };
}

function buildTimelineEntries({ referral, history, notes, conflicts, triage, resolveUser, resolveMarketer, isPediatric }) {
  const stageNotes = [];
  const plainNotes = [];
  for (const n of notes) {
    const parsed = parseStageTransitionNote(n.content);
    if (parsed) stageNotes.push({ note: n, ...parsed });
    else plainNotes.push(n);
  }

  const matchedNoteIds = new Set();
  const stageEntries = history.map((h) => {
    const histTime = new Date(h.timestamp || 0).getTime();
    const match = stageNotes.find(
      (sn) =>
        !matchedNoteIds.has(sn.note._id) &&
        sn.toStage === h.to_stage &&
        Math.abs(new Date(sn.note.created_at || 0).getTime() - histTime) < 60_000,
    );
    if (match) matchedNoteIds.add(match.note._id);
    return {
      _id: h._id,
      type: 'stage',
      timestamp: h.timestamp,
      title: h.to_stage
        ? `Stage change: ${h.from_stage || '—'} → ${h.to_stage}`
        : 'Stage updated',
      noteContent: match?.body || h.reason || null,
      actor: match?.note.author_id || h.changed_by_id || null,
    };
  });

  const orphanStageNotes = stageNotes
    .filter((sn) => !matchedNoteIds.has(sn.note._id))
    .map((sn) => ({
      _id: sn.note._id,
      type: 'stage',
      timestamp: sn.note.created_at,
      title: `Stage change: ${sn.fromStage} → ${sn.toStage}`,
      noteContent: sn.body || null,
      actor: sn.note.author_id || null,
    }));

  return [
    ...(referral?.referral_date ? [{
      _id: 'referral-created',
      type: 'referral',
      timestamp: referral.referral_date,
      title: 'Referral created',
      detail: 'Entered at Lead Entry stage',
      actor: referral.marketer_id || null,
      actorResolved: referral.marketer_id ? resolveMarketer?.(referral.marketer_id) : null,
    }] : []),
    ...stageEntries,
    ...orphanStageNotes,
    ...plainNotes.map((n) => ({
      _id: n._id,
      type: 'note',
      timestamp: n.created_at,
      title: 'Note added',
      noteContent: n.content,
      actor: n.author_id,
    })),
    ...conflicts.flatMap((c) => {
      const categoryLabel = conflictCategoryLabel(c.type);
      const description = c.description || c.details || '';
      const displaySeverity = normalizeSeverity(c.severity);
      const out = [{
        _id: `conflict-flagged-${c._id}`,
        type: 'conflict',
        timestamp: c.created_at,
        title: `${categoryLabel} conflict`,
        detail: displaySeverity ? `Severity: ${displaySeverity}` : null,
        noteContent: description || null,
        actor: c.flagged_by_id || c.created_by_id || null,
      }];
      if (c.resolved_at && (c.status === 'Resolved' || c.status === 'Waived')) {
        out.push({
          _id: `conflict-resolved-${c._id}`,
          type: 'conflict-resolved',
          timestamp: c.resolved_at,
          title: `${categoryLabel} conflict ${c.status === 'Waived' ? 'waived' : 'resolved'}`,
          noteContent: c.resolution_note || null,
          actor: c.resolved_by_id || null,
        });
      }
      return out;
    }),
    ...(triage?.created_at ? [{
      _id: 'triage-completed',
      type: 'milestone',
      timestamp: triage.created_at,
      title: 'Initial Triage Completed',
      detail: isPediatric ? 'Pediatric Special Needs triage form' : 'Adult Special Needs triage form',
      actor: triage.filled_by_id || null,
    }] : []),
    ...referralMilestones(referral),
  ].sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
}

function buildTimelinePdf(entries, resolveUser, resolveMarketer) {
  const s = createSectionDoc('Patient Timeline');
  s.sectionHeader('Referral Timeline');
  s.bodyText(
    entries.length
      ? `${entries.length} event${entries.length === 1 ? '' : 's'} · oldest first`
      : 'No timeline events yet.',
    { size: 8, color: INK.muted },
  );
  s.gap(3);

  for (const entry of entries) {
    s.ensureSpace(16);
    const actor = entry.actorResolved
      || resolveName(entry.actor, resolveUser, resolveMarketer)
      || null;
    s.bodyText(fmtDateTime(entry.timestamp), { size: 7.5, color: INK.muted });
    s.bodyText(entry.title || 'Event', { bold: true, size: 9 });
    if (entry.detail) s.bodyText(entry.detail, { size: 8, color: INK.label });
    if (actor) s.bodyText(`By: ${actor}`, { size: 8, color: INK.muted });
    if (entry.noteContent) {
      s.gap(1);
      s.bodyText(humanizeUserIds(entry.noteContent, resolveUser), { size: 8.5, color: INK.body });
    }
    s.gap(2);
    s.doc.setDrawColor(...INK.rule);
    s.doc.line(s.marginL, s.y, s.pageW - s.marginR, s.y);
    s.gap(3.5);
  }

  s.paintFooter();
  return s.doc.output('arraybuffer');
}

function buildFileManifestPdf(files) {
  const s = createSectionDoc('File Manifest');
  s.sectionHeader('Patient Files Included');
  s.bodyText(
    files.length
      ? `${files.length} file${files.length === 1 ? '' : 's'} in Patient_Files/`
      : 'No patient files.',
    { size: 8, color: INK.muted },
  );
  s.gap(3);

  for (const file of files) {
    s.ensureSpace(12);
    s.bodyText(file.file_name || 'Untitled file', { bold: true, size: 9 });
    const meta = [
      file.category || null,
      file.created_at ? `Uploaded ${fmtDateTime(file.created_at)}` : null,
      file.file_type || null,
    ].filter(Boolean).join(' · ');
    if (meta) s.bodyText(meta, { size: 8, color: INK.muted });
    s.gap(3);
  }

  s.paintFooter();
  return s.doc.output('arraybuffer');
}

async function appendPdfBytes(merged, bytes) {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = await merged.copyPages(src, src.getPageIndices());
  for (const page of pages) merged.addPage(page);
}

/**
 * Build the house-made EMR onboarding PDF (cover + optional file list + notes + timeline).
 * Patient uploads are NOT embedded — they ship as original files in the ZIP.
 */
async function buildHousePacketPdf({
  referral,
  resolveSource,
  resolveUser,
  resolveMarketer,
  notes,
  timelineEntries,
  files,
}) {
  const coverBytes = await buildCoverPdf(referral, resolveSource, { fileCount: files.length });
  const notesBytes = buildNotesPdf(notes, resolveUser);
  const timelineBytes = buildTimelinePdf(timelineEntries, resolveUser, resolveMarketer);

  const merged = await PDFDocument.create();
  await appendPdfBytes(merged, coverBytes);
  if (files.length > 0) {
    await appendPdfBytes(merged, buildFileManifestPdf(files));
  }
  await appendPdfBytes(merged, notesBytes);
  await appendPdfBytes(merged, timelineBytes);
  return merged.save();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate and download the EMR Onboarding Packet.
 *
 * - Always builds a clean house-made PDF (demographics, notes, timeline).
 * - If the patient has ANY uploaded files, downloads a ZIP named with the
 *   patient name containing that PDF + every original patient file.
 * - If there are no files, downloads the PDF alone.
 *
 * @param {object} referral
 * @param {Function|object} resolveSourceOrOpts  legacy resolveSource fn, or opts bag
 * @param {object} [maybeOpts]
 */
export async function generateEmrPacket(referral, resolveSourceOrOpts, maybeOpts) {
  const opts = typeof resolveSourceOrOpts === 'function'
    ? { resolveSource: resolveSourceOrOpts, ...(maybeOpts || {}) }
    : (resolveSourceOrOpts || {});

  const {
    resolveSource,
    resolveUser = () => '—',
    resolveMarketer = () => '—',
  } = opts;

  const patientId = referral.patient_id || referral.patient?.id || referral.patient?._id;
  const referralId = referral.id || referral._id;
  const patient = referral.patient || {};

  const [fileRecs, noteRecs, historyRecs, conflictRecs] = await Promise.all([
    patientId ? getFilesByPatient(patientId).catch(() => []) : Promise.resolve([]),
    patientId ? getNotesByPatient(patientId).catch(() => []) : Promise.resolve([]),
    referralId ? getStageHistory(referralId).catch(() => []) : Promise.resolve([]),
    referralId ? getConflictsByReferral(referralId).catch(() => []) : Promise.resolve([]),
  ]);

  const files = fileRecs
    .map((r) => ({ _id: r.id, ...r.fields }))
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

  const notes = noteRecs
    .map((r) => ({ _id: r.id, ...r.fields }))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const history = historyRecs.map((r) => ({ _id: r.id, ...r.fields }));
  const conflicts = conflictRecs.map((r) => ({ _id: r.id, ...r.fields }));

  let triage = null;
  const isSN = (patient.division || referral.division) === 'Special Needs';
  let isPediatric = false;
  if (isSN && referralId) {
    const age = patient.dob
      ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / (365.25 * 86400000))
      : null;
    isPediatric = age !== null && age < 18;
    try {
      const recs = await (isPediatric ? getTriagePediatric : getTriageAdult)(referralId);
      if (recs.length) triage = { _id: recs[0].id, ...recs[0].fields };
    } catch { /* optional */ }
  }

  const timelineEntries = buildTimelineEntries({
    referral, history, notes, conflicts, triage, resolveUser, resolveMarketer, isPediatric,
  });

  const packetBytes = await buildHousePacketPdf({
    referral,
    resolveSource,
    resolveUser,
    resolveMarketer,
    notes,
    timelineEntries,
    files,
  });

  const { last, first } = patientNameParts(patient);
  const nameStem = first ? `${last}_${first}` : last;
  const dateStr = new Date().toISOString().split('T')[0];

  // No uploads → clean PDF only.
  if (files.length === 0) {
    downloadBlob(packetBytes, `${nameStem}_EMR_Onboarding_${dateStr}.pdf`, 'application/pdf');
    return;
  }

  // Any patient files → ZIP with house packet + every original upload.
  const zip = new JSZip();
  zip.file('EMR_Onboarding_Packet.pdf', packetBytes);

  const filesFolder = zip.folder('Patient_Files');
  const usedNames = new Set();
  const failed = [];

  await Promise.all(files.map(async (file) => {
    const zipName = uniqueZipName(usedNames, file.file_name || `file_${file._id || 'unknown'}`);
    try {
      const bytes = await fetchFileBytes(file);
      filesFolder.file(zipName, bytes);
    } catch (err) {
      failed.push({ name: zipName, reason: err?.message || 'Download failed' });
    }
  }));

  if (failed.length > 0) {
    const lines = [
      'Some patient files could not be downloaded into this ZIP.',
      'Open them from the CareStream patient Files tab.',
      '',
      ...failed.map((f) => `- ${f.name}: ${f.reason}`),
    ];
    zip.file('MISSING_FILES.txt', lines.join('\n'));
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(zipBlob, `${nameStem}_EMR_Onboarding_${dateStr}.zip`, 'application/zip');
}
