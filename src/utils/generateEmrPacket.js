import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import { getPhysician } from '../api/physicians.js';
import { getFilesByPatient } from '../api/patientFiles.js';
import { getNotesByPatient } from '../api/notes.js';
import { getStageHistory } from '../api/stageHistory.js';
import { getConflictsByReferral } from '../api/conflicts.js';
import { getTriageAdult, getTriagePediatric } from '../api/triage.js';
import { getSignedFileUrl } from './r2Upload.js';
import { conflictCategoryLabel, normalizeSeverity } from './conflictFlagging.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt     = (v)  => (v != null && v !== '') ? String(v) : '—';
const fmtDate = (v)  => {
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

function fileKind(file) {
  const name = (file.file_name || '').toLowerCase();
  const type = (file.file_type || '').toLowerCase();
  const ext = name.split('.').pop();
  if (ext === 'pdf' || type.includes('pdf')) return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) || type.startsWith('image/')) {
    if (ext === 'png' || type.includes('png')) return 'png';
    return 'jpg';
  }
  return 'other';
}

function downloadBlob(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ── jsPDF section document builder ────────────────────────────────────────────

function createSectionDoc(title) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageW = 215.9;
  const pageH = 279.4;
  const marginL = 20;
  const marginR = 20;
  const contentW = pageW - marginL - marginR;
  let y = 0;

  function paintHeader() {
    doc.setFillColor(196, 30, 110);
    doc.rect(0, 0, pageW, 16, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(255, 255, 255);
    doc.text('WELLBOUND CARESTREAM', marginL, 10.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(title, pageW - marginR, 10.5, { align: 'right' });
    y = 24;
  }

  function paintFooter() {
    doc.setDrawColor(229, 231, 235);
    doc.line(marginL, pageH - 16, pageW - marginR, pageH - 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(156, 163, 175);
    doc.text(
      'Wellbound CareStream  ·  Confidential — for internal EMR onboarding use only.',
      pageW / 2, pageH - 10, { align: 'center' },
    );
  }

  function ensureSpace(needed = 12) {
    if (y + needed > pageH - 22) {
      paintFooter();
      doc.addPage();
      paintHeader();
    }
  }

  function sectionHeader(label) {
    ensureSpace(14);
    doc.setFillColor(252, 245, 249);
    doc.rect(marginL, y - 1.5, contentW, 8, 'F');
    doc.setDrawColor(234, 179, 208);
    doc.line(marginL, y + 6.5, pageW - marginR, y + 6.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(196, 30, 110);
    doc.text(label.toUpperCase(), marginL + 3, y + 4.5);
    y += 11;
  }

  function row(label, value) {
    ensureSpace(8);
    const colBreak = 58;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text(label, marginL + 3, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(26, 26, 46);
    const lines = doc.splitTextToSize(fmt(value), contentW - colBreak - 6);
    doc.text(lines, marginL + 3 + colBreak, y);
    y += Math.max(6, lines.length * 4.5);
  }

  function bodyText(text, { bold = false, size = 9, color = [26, 26, 46] } = {}) {
    const lines = doc.splitTextToSize(String(text || ''), contentW - 6);
    for (const line of lines) {
      ensureSpace(6);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...color);
      doc.text(line, marginL + 3, y);
      y += size * 0.45 + 1.5;
    }
  }

  function gap(n = 5) { y += n; }

  paintHeader();

  return {
    doc, pageW, pageH, marginL, marginR, contentW,
    get y() { return y; },
    set y(v) { y = v; },
    paintHeader, paintFooter, ensureSpace, sectionHeader, row, bodyText, gap,
  };
}

// ── Cover / demographics sheet ────────────────────────────────────────────────

async function buildCoverPdf(referral, resolveSource) {
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

  s.doc.setFontSize(8);
  s.doc.setTextColor(107, 114, 128);
  s.doc.text(`Generated: ${fmtDate(new Date())}`, s.marginL, s.y);
  s.doc.text(`SOC Date: ${fmtDate(referral.soc_scheduled_date)}`, s.pageW - s.marginR, s.y, { align: 'right' });
  s.y += 5;
  s.doc.setDrawColor(229, 231, 235);
  s.doc.line(s.marginL, s.y, s.pageW - s.marginR, s.y);
  s.y += 7;

  s.sectionHeader('Basic Info');
  s.row('Branch(es)', isSN ? 'S01, S02, WSI' : isALF ? 'A01, WA1' : '—');
  s.row('Patient Last Name', p.last_name);
  s.row('Patient First Name', p.first_name);
  s.gap();

  s.sectionHeader('Demographics');
  s.row('Gender', p.gender);
  s.row('Date of Birth', fmtDate(p.dob));
  s.row('Phone', p.phone_primary);
  if (p.phone_secondary) s.row('Phone (Alt)', p.phone_secondary);
  if (p.address_street) {
    s.row('Address', [p.address_street, p.address_city].filter(Boolean).join(', '));
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
    { size: 8, color: [107, 114, 128] },
  );
  s.gap(4);

  if (!notes.length) {
    s.paintFooter();
    return s.doc.output('arraybuffer');
  }

  for (const n of notes) {
    s.ensureSpace(20);
    const author = resolveName(n.author_id, resolveUser) || 'Unknown';
    const when = fmtDateTime(n.created_at);
    s.bodyText(`${when}  ·  ${author}`, { bold: true, size: 8, color: [196, 30, 110] });
    s.gap(1);
    const content = humanizeUserIds(n.content || '(empty note)', resolveUser);
    s.bodyText(content, { size: 9 });
    s.gap(2);
    s.doc.setDrawColor(229, 231, 235);
    s.doc.line(s.marginL, s.y, s.pageW - s.marginR, s.y);
    s.gap(5);
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
    { size: 8, color: [107, 114, 128] },
  );
  s.gap(4);

  for (const entry of entries) {
    s.ensureSpace(18);
    const actor = entry.actorResolved
      || resolveName(entry.actor, resolveUser, resolveMarketer)
      || null;
    s.bodyText(fmtDateTime(entry.timestamp), { size: 7.5, color: [107, 114, 128] });
    s.bodyText(entry.title || 'Event', { bold: true, size: 9 });
    if (entry.detail) s.bodyText(entry.detail, { size: 8, color: [75, 85, 99] });
    if (actor) s.bodyText(`By: ${actor}`, { size: 8, color: [107, 114, 128] });
    if (entry.noteContent) {
      s.gap(1);
      s.bodyText(humanizeUserIds(entry.noteContent, resolveUser), { size: 8.5, color: [55, 65, 81] });
    }
    s.gap(2);
    s.doc.setDrawColor(229, 231, 235);
    s.doc.line(s.marginL, s.y, s.pageW - s.marginR, s.y);
    s.gap(4);
  }

  s.paintFooter();
  return s.doc.output('arraybuffer');
}

// ── File divider / placeholder pages ──────────────────────────────────────────

function buildFileDividerPdf(file, { status = 'Included below', detail = '' } = {}) {
  const s = createSectionDoc('Patient File');
  s.sectionHeader('Attached Patient File');
  s.row('File Name', file.file_name || '—');
  s.row('Category', file.category || '—');
  s.row('Uploaded', fmtDateTime(file.created_at));
  s.row('Status', status);
  if (detail) {
    s.gap(3);
    s.bodyText(detail, { size: 9, color: [107, 114, 128] });
  }
  s.paintFooter();
  return s.doc.output('arraybuffer');
}

// ── pdf-lib merge helpers ─────────────────────────────────────────────────────

async function appendPdfBytes(merged, bytes) {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = await merged.copyPages(src, src.getPageIndices());
  for (const page of pages) merged.addPage(page);
}

async function appendImageFile(merged, bytes, kind) {
  const page = merged.addPage([612, 792]); // letter points
  let image;
  try {
    image = kind === 'png'
      ? await merged.embedPng(bytes)
      : await merged.embedJpg(bytes);
  } catch {
    try {
      image = kind === 'png'
        ? await merged.embedJpg(bytes)
        : await merged.embedPng(bytes);
    } catch {
      return false;
    }
  }

  const { width, height } = image.scale(1);
  const maxW = 552;
  const maxH = 700;
  const scale = Math.min(maxW / width, maxH / height, 1);
  const w = width * scale;
  const h = height * scale;
  page.drawImage(image, {
    x: (612 - w) / 2,
    y: (792 - h) / 2,
    width: w,
    height: h,
  });
  return true;
}

async function fetchFileBytes(file) {
  const url = await getSignedFileUrl(file);
  if (!url) throw new Error('No signed URL');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate and download the EMR Onboarding Packet.
 *
 * Packet order:
 *   1. Cover / demographics
 *   2. Every patient file (PDF pages or images embedded; others listed)
 *   3. All patient notes
 *   4. Full referral timeline (last)
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

  // Parallel fetch of packet data
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

  // Triage (Special Needs only)
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

  // Build text sections
  const coverBytes = await buildCoverPdf(referral, resolveSource);
  const notesBytes = buildNotesPdf(notes, resolveUser);
  const timelineBytes = buildTimelinePdf(timelineEntries, resolveUser, resolveMarketer);

  // Merge into final packet
  const merged = await PDFDocument.create();
  await appendPdfBytes(merged, coverBytes);

  // Patient files
  if (files.length === 0) {
    const emptyDivider = buildFileDividerPdf(
      { file_name: '(none)', category: '—', created_at: null },
      { status: 'No files on file', detail: 'This patient has no uploaded documents in CareStream.' },
    );
    await appendPdfBytes(merged, emptyDivider);
  } else {
    for (const file of files) {
      const kind = fileKind(file);
      try {
        const bytes = await fetchFileBytes(file);
        if (kind === 'pdf') {
          await appendPdfBytes(merged, buildFileDividerPdf(file, { status: 'Embedded below' }));
          await appendPdfBytes(merged, bytes);
        } else if (kind === 'png' || kind === 'jpg') {
          await appendPdfBytes(merged, buildFileDividerPdf(file, { status: 'Embedded below' }));
          const ok = await appendImageFile(merged, bytes, kind);
          if (!ok) {
            await appendPdfBytes(merged, buildFileDividerPdf(file, {
              status: 'Could not embed image',
              detail: 'Open this file from the patient Files tab in CareStream.',
            }));
          }
        } else {
          await appendPdfBytes(merged, buildFileDividerPdf(file, {
            status: 'Not embeddable in PDF',
            detail: `File type “${file.file_type || file.file_name || 'unknown'}” cannot be rendered inline. Open it from the patient Files tab in CareStream.`,
          }));
        }
      } catch (err) {
        await appendPdfBytes(merged, buildFileDividerPdf(file, {
          status: 'Could not include file',
          detail: err?.message || 'Download failed. Open this file from the patient Files tab in CareStream.',
        }));
      }
    }
  }

  await appendPdfBytes(merged, notesBytes);
  await appendPdfBytes(merged, timelineBytes);

  const lastName = (patient.last_name || 'Patient').replace(/\s+/g, '_');
  const firstName = (patient.first_name || '').replace(/\s+/g, '_');
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `EMR_Onboarding_${lastName}_${firstName}_${dateStr}.pdf`;

  const out = await merged.save();
  downloadBlob(out, filename);
}
