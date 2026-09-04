/**
 * OpwddWorkspace — revamped OPWDD flow (2026-08-26).
 *
 * Two phases, five steps per patient in the OPWDD module:
 *
 *   PHASE 1 (all steps run side by side, concurrently)
 *     Step 1 — Packet Assembly (mark assembled)
 *     Step 2 — Psychological & Psycho-Social visit scheduling (mark scheduled + date)
 *     Step 3 — Mark visits completed, one at a time
 *
 *   PHASE 2
 *     Step 4 — Submit to a health home: log the date submitted and who it was
 *              submitted to (searchable dropdown from the
 *              HomehealthOpwddEntities lookup table). Shows Submitted + Pending.
 *     Step 5 — Upon receipt of the letter from the parent: upload the file,
 *              mark the case completed, and send the referral back to Intake.
 *
 * Step state derives from case timestamps (packet_assembled_at,
 * *_scheduled_for, *_visit_completed_at, submission_sent_at,
 * parent_letter_received_at) — the legacy status vocabulary stays valid for
 * old-UI users and reporting.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentAppUser }  from '../../../hooks/useCurrentAppUser.js';
import { useLookups }         from '../../../hooks/useLookups.js';
import { usePermissions }     from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS }    from '../../../data/permissionKeys.js';
import { triggerDataRefresh } from '../../../hooks/useRefreshTrigger.js';
import palette, { hexToRgba } from '../../../utils/colors.js';
import { fmtCalendarDate, fmtDateTime } from '../../../utils/dateFormat.js';
import { uploadToR2, openSignedFile } from '../../../utils/r2Upload.js';
import { createFile } from '../../../api/patientFiles.js';
import { mergeEntities } from '../../../store/careStore.js';

import {
  OPWDD_CASE_STATUS,
  OPWDD_CLOSED_REASON_OPTIONS,
  OPWDD_VISIT_TYPES,
  OPWDD_PACKET_DOCS,
  OPWDD_SATISFIED_STATUSES,
  OPWDD_REQUIREMENT_TO_CATEGORY,
  getOpwddFlowState,
} from '../../../data/opwddEnums.js';

import { useOpwddData } from './useOpwddData.js';
import { updateOpwddCase } from '../../../api/opwddCases.js';
import { getAllOpwddEntities } from '../../../api/opwddEntities.js';
import {
  openCaseForReferral,
  markPacketAssembled,
  setPacketDocChecked,
  scheduleOpwddVisit,
  markOpwddVisitCompleted,
  submitToHealthhome,
  completeCaseWithParentLetter,
  closeCase,
} from '../../../store/opwddOrchestration.js';

import { tokens, inputStyle, primaryBtn, secondaryBtn, cardStyle } from './workspaceStyles.js';

const fmtDate = fmtCalendarDate;

// ── Small building blocks ────────────────────────────────────────────────────

function Pill({ bg, fg, children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: bg, color: fg, fontSize: 10.5, fontWeight: 750,
      padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

const DonePill    = ({ children = 'Done' })    => <Pill bg="#DCFCE7" fg="#15803d">✓ {children}</Pill>;
const PendingPill = ({ children = 'Pending' }) => <Pill bg="#FEF3C7" fg="#92400E">{children}</Pill>;
const IdlePill    = ({ children = 'Not started' }) => <Pill bg="#EEE" fg="#666">{children}</Pill>;

function StepCard({ t, number, title, statusPill, children, muted = false }) {
  return (
    <div style={{ ...cardStyle(t), opacity: muted ? 0.55 : 1 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        padding: `${t.cardPadY}px ${t.cardPadX}px`,
        borderBottom: children ? '1px solid var(--color-border)' : 'none',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
            background: hexToRgba(palette.backgroundDark.hex, 0.07),
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 800, color: hexToRgba(palette.backgroundDark.hex, 0.6),
          }}>
            {number}
          </span>
          <span style={{ fontSize: t.fontBase, fontWeight: 700, color: palette.backgroundDark.hex }}>{title}</span>
        </span>
        {statusPill}
      </div>
      {children && <div style={{ padding: `${t.cardPadY}px ${t.cardPadX}px` }}>{children}</div>}
    </div>
  );
}

function PhaseHeading({ t, children }) {
  return (
    <p style={{
      fontSize: t.fontLabel, fontWeight: 800, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.45),
      margin: `${t.sectionGap}px 0 ${Math.max(6, t.gap - 2)}px`,
    }}>
      {children}
    </p>
  );
}

function MetaLine({ t, children }) {
  return (
    <p style={{ margin: '4px 0 0', fontSize: t.fontMuted, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.4 }}>
      {children}
    </p>
  );
}

// ── Searchable entity dropdown (HomehealthOpwddEntities) ────────────────────

function EntityPicker({ t, entities, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entities;
    return entities.filter((e) => (
      (e.name || '').toLowerCase().includes(q)
      || (e.category || '').toLowerCase().includes(q)
      || (Array.isArray(e.counties) ? e.counties.join(' ') : String(e.counties || '')).toLowerCase().includes(q)
    ));
  }, [entities, query]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...inputStyle(t),
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: value ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.4),
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value ? value.name : 'Select submission partner…'}
        </span>
        <span style={{ fontSize: 9, opacity: 0.5, flexShrink: 0 }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 60,
          background: palette.backgroundLight.hex,
          border: '1px solid var(--color-border)', borderRadius: 8,
          boxShadow: `0 8px 24px ${hexToRgba(palette.backgroundDark.hex, 0.14)}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: 300,
        }}>
          <div style={{ padding: '8px 8px 6px', flexShrink: 0 }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, type, or county…"
              style={{ ...inputStyle(t), padding: '6px 8px' }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: '0 0 6px' }}>
            {shown.length === 0 ? (
              <p style={{ padding: '10px 12px', margin: 0, fontSize: t.fontMuted, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                No matching entities
              </p>
            ) : shown.map((e) => (
              <button
                key={e.id || e._id}
                type="button"
                onClick={() => { onChange(e); setOpen(false); setQuery(''); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '7px 12px', border: 'none', cursor: 'pointer',
                  background: value && (value.id === e.id) ? hexToRgba(palette.accentBlue.hex, 0.07) : 'transparent',
                }}
              >
                <span style={{ display: 'block', fontSize: t.fontBase, fontWeight: 650, color: palette.backgroundDark.hex }}>
                  {e.name}
                </span>
                <span style={{ display: 'block', fontSize: t.fontMuted - 1, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginTop: 1 }}>
                  {[e.category, Array.isArray(e.counties) && e.counties.length ? e.counties.join(', ') : null]
                    .filter(Boolean).join(' · ')}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Packet document row (Step 1) — upload (multi-file) + check ──────────────

function PacketDocRow({ t, doc, index, files, checked, canCheck, canUpload, uploading, disabled, onToggle, onUpload }) {
  const inputRef = useRef(null);
  return (
    <div style={{ padding: '8px 0', borderBottom: index < OPWDD_PACKET_DOCS.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={!canCheck || disabled}
          onChange={(e) => onToggle(e.target.checked)}
          title={checked ? 'Uncheck document' : 'Check document as complete'}
          style={{
            accentColor: palette.accentGreen.hex, width: 14, height: 14,
            marginTop: 2, flexShrink: 0,
            cursor: canCheck && !disabled ? 'pointer' : 'not-allowed',
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            fontSize: t.fontMuted + 0.5, fontWeight: 700,
            color: checked ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.75),
          }}>
            {doc.label}
            {!doc.required && (
              <span style={{ fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}> · if applicable</span>
            )}
          </span>
          {doc.hint && (
            <span style={{ display: 'block', fontSize: t.fontMuted - 1, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 1 }}>
              {doc.hint}
            </span>
          )}
          {files.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
              {files.map((f) => (
                <button
                  key={f._id}
                  type="button"
                  title={`Open ${f.file_name}`}
                  onClick={() => openSignedFile(f).catch(() => {})}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    maxWidth: 190, padding: '2px 8px', borderRadius: 20,
                    border: '1px solid var(--color-border)', cursor: 'pointer',
                    background: hexToRgba(palette.accentBlue.hex, 0.06),
                    fontSize: t.fontMuted - 1, fontWeight: 600, color: palette.accentBlue.hex,
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.file_name || f.id}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        {canUpload && !disabled && (
          <>
            <input
              ref={inputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { onUpload(e.target.files); e.target.value = ''; }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              style={{
                flexShrink: 0, padding: '3px 9px', borderRadius: 5,
                border: '1px solid var(--color-border)',
                background: palette.backgroundLight.hex,
                fontSize: t.fontMuted - 1, fontWeight: 700,
                color: uploading ? hexToRgba(palette.backgroundDark.hex, 0.35) : palette.accentBlue.hex,
                cursor: uploading ? 'wait' : 'pointer',
              }}
            >
              {uploading ? 'Uploading…' : files.length ? '+ Add' : 'Upload'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main workspace ───────────────────────────────────────────────────────────

export default function OpwddWorkspace({
  patient,
  referral,
  readOnly = false,
  variant = 'drawer',
  onInitiateTransition, // eslint-disable-line no-unused-vars -- kept for StagePanel prop compatibility
  onOpenFiles,
}) {
  const t = tokens(variant);
  const { appUserId } = useCurrentAppUser();
  const { resolveUser } = useLookups();
  const { can } = usePermissions();

  const canEdit     = !readOnly && can(PERMISSION_KEYS.OPWDD_CASE_EDIT);
  const canCreate   = !readOnly && can(PERMISSION_KEYS.OPWDD_CASE_CREATE);
  const canSubmit   = !readOnly && can(PERMISSION_KEYS.OPWDD_SUBMIT_PACKET);
  const canConvert  = !readOnly && can(PERMISSION_KEYS.OPWDD_CONVERT_TO_INTAKE);
  const canClose    = !readOnly && can(PERMISSION_KEYS.OPWDD_CLOSE_CASE);
  const canEditList = !readOnly && can(PERMISSION_KEYS.OPWDD_CHECKLIST_EDIT);
  const canUpload   = !readOnly && can(PERMISSION_KEYS.OPWDD_FILE_UPLOAD);

  const { loading, error, activeCase, checklistItems, opwddFiles, reload } = useOpwddData({
    patientId: patient?.id,
    referralId: referral?.id,
  });

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Entities lookup for the submission dropdown (dynamic — straight from DB).
  const [entities, setEntities] = useState([]);
  useEffect(() => {
    let cancelled = false;
    getAllOpwddEntities()
      .then((recs) => {
        if (cancelled) return;
        const mapped = recs
          .map((r) => ({ _id: r.id, ...r.fields }))
          .filter((e) => e.is_active !== false);
        setEntities(mapped);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Local step inputs
  const [psychDate, setPsychDate] = useState('');
  const [psychosocialDate, setPsychosocialDate] = useState('');
  const [submitEntity, setSubmitEntity] = useState(null);
  const [submitDate, setSubmitDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [uploadingLetter, setUploadingLetter] = useState(false);
  const letterInputRef = useRef(null);
  const [closeReason, setCloseReason] = useState('');
  const [showClose, setShowClose] = useState(false);

  const flow = getOpwddFlowState(activeCase);

  // ── Packet Assembly (Step 1) derived state ─────────────────────────────────
  const itemByKey = useMemo(
    () => Object.fromEntries((checklistItems || []).map((i) => [i.requirement_key, i])),
    [checklistItems],
  );
  const filesByDocKey = useMemo(() => {
    const map = {};
    if (!activeCase) return map;
    for (const f of opwddFiles || []) {
      if (f.opwdd_case_id !== activeCase.id || !f.document_subtype) continue;
      (map[f.document_subtype] ||= []).push(f);
    }
    return map;
  }, [opwddFiles, activeCase]);

  const isDocChecked = (doc) => {
    const item = itemByKey[doc.key];
    return !!item && OPWDD_SATISFIED_STATUSES.includes(item.status);
  };
  const checkedDocCount = OPWDD_PACKET_DOCS.filter(isDocChecked).length;
  const requiredDocsDone = OPWDD_PACKET_DOCS.filter((d) => d.required).every(isDocChecked);

  const [uploadingDocKey, setUploadingDocKey] = useState(null);

  async function handleUploadDocFiles(doc, fileList) {
    const docFiles = Array.from(fileList || []);
    if (!docFiles.length || !activeCase) return;
    setUploadingDocKey(doc.key);
    setActionError(null);
    try {
      const merged = {};
      for (const file of docFiles) {
        const { r2Key, r2Url } = await uploadToR2(file, patient);
        const created = await createFile({
          id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          patient_id: patient.id,
          uploaded_by_id: appUserId || 'unknown',
          file_name: file.name,
          file_size: file.size,
          r2_key: r2Key,
          r2_url: r2Url,
          category: OPWDD_REQUIREMENT_TO_CATEGORY[doc.key] || 'OPWDD',
          document_subtype: doc.key,
          created_at: new Date().toISOString(),
          ...(referral?.id ? { referral_id: referral.id } : {}),
          opwdd_case_id: activeCase.id,
        });
        merged[created.id] = { _id: created.id, ...created.fields };
      }
      mergeEntities('files', merged);
      triggerDataRefresh();
      reload();
    } catch (err) {
      setActionError(err?.message || `Upload failed for ${doc.label}`);
    } finally {
      setUploadingDocKey(null);
    }
  }

  async function run(fn) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(err?.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadLetter(file) {
    if (!file || !activeCase) return;
    setUploadingLetter(true);
    setActionError(null);
    try {
      const { r2Key, r2Url } = await uploadToR2(file, patient);
      const fileId = `file_${Date.now()}`;
      const created = await createFile({
        id: fileId,
        patient_id: patient.id,
        uploaded_by_id: appUserId || 'unknown',
        file_name: file.name,
        file_size: file.size,
        r2_key: r2Key,
        r2_url: r2Url,
        category: 'OPWDD Notice',
        created_at: new Date().toISOString(),
        ...(referral?.id ? { referral_id: referral.id } : {}),
        opwdd_case_id: activeCase.id,
      });
      mergeEntities('files', { [created.id]: { _id: created.id, ...created.fields } });
      // Stamp immediately so the uploaded letter survives a reload before the
      // user clicks "Mark completed".
      await updateOpwddCase(activeCase._id, { parent_letter_file_id: fileId });
      triggerDataRefresh();
      reload();
    } catch (err) {
      setActionError(err?.message || 'Letter upload failed');
    } finally {
      setUploadingLetter(false);
      if (letterInputRef.current) letterInputRef.current.value = '';
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading && !activeCase) {
    return <p style={{ fontSize: t.fontBase, color: hexToRgba(palette.backgroundDark.hex, 0.5), padding: 8 }}>Loading OPWDD case…</p>;
  }
  if (error) {
    return <p style={{ fontSize: t.fontBase, color: palette.primaryMagenta.hex, padding: 8 }}>Failed to load: {error}</p>;
  }

  if (!activeCase) {
    return (
      <div style={{ padding: 4 }}>
        <p style={{ fontSize: t.fontBase, color: hexToRgba(palette.backgroundDark.hex, 0.6), margin: '0 0 10px' }}>
          No open OPWDD case for this referral.
        </p>
        {canCreate && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => openCaseForReferral({ referral, patientId: patient?.id, actorUserId: appUserId }))}
            style={primaryBtn(t, { disabled: busy })}
          >
            {busy ? 'Opening…' : 'Open OPWDD case'}
          </button>
        )}
        {actionError && <MetaLine t={t}>{actionError}</MetaLine>}
      </div>
    );
  }

  const caseDone = flow.completed || activeCase.status === OPWDD_CASE_STATUS.CLOSED || activeCase.status === OPWDD_CASE_STATUS.CANCELLED;
  const submittedBy = activeCase.submission_sent_by_id ? resolveUser(activeCase.submission_sent_by_id) : null;
  const letterUploaded = !!activeCase.parent_letter_file_id;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
        <span style={{ fontSize: t.fontMuted, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>
          Case {activeCase.id} · opened {fmtDate(activeCase.opened_at) || '—'}
        </span>
        {caseDone
          ? <DonePill>{flow.completed ? 'Completed' : 'Closed'}</DonePill>
          : flow.submitted
            ? <PendingPill>Pending letter</PendingPill>
            : flow.phase1Complete
              ? <Pill bg="#DBEAFE" fg="#1D4ED8">Ready to submit</Pill>
              : <Pill bg="#E0F2FE" fg="#0369A1">Phase 1</Pill>}
      </div>

      {actionError && (
        <p style={{ margin: '6px 0', fontSize: t.fontMuted, color: palette.primaryMagenta.hex }}>{actionError}</p>
      )}

      {/* ── PHASE 1 ── */}
      <PhaseHeading t={t}>Phase 1 · concurrent steps</PhaseHeading>

      {/* Step 1 — Packet Assembly: 9 documents, each with upload(s) + check */}
      <StepCard
        t={t}
        number={1}
        title="Packet Assembly"
        statusPill={flow.packetAssembled
          ? <DonePill>Assembled</DonePill>
          : checkedDocCount > 0
            ? <PendingPill>{checkedDocCount}/{OPWDD_PACKET_DOCS.length} checked</PendingPill>
            : <IdlePill />}
      >
        {flow.packetAssembled && (
          <MetaLine t={t}>
            Assembled {fmtDateTime(activeCase.packet_assembled_at)}
            {activeCase.packet_assembled_by_id ? ` by ${resolveUser(activeCase.packet_assembled_by_id)}` : ''}
          </MetaLine>
        )}
        <div style={{ marginTop: flow.packetAssembled ? 6 : 0 }}>
          {OPWDD_PACKET_DOCS.map((doc, index) => (
            <PacketDocRow
              key={doc.key}
              t={t}
              doc={doc}
              index={index}
              files={filesByDocKey[doc.key] || []}
              checked={isDocChecked(doc)}
              canCheck={canEditList}
              canUpload={canUpload}
              uploading={uploadingDocKey === doc.key}
              disabled={busy || caseDone}
              onToggle={(checked) => run(() => setPacketDocChecked({
                opwddCase: activeCase, doc, item: itemByKey[doc.key], checked, actorUserId: appUserId,
              }))}
              onUpload={(fileList) => handleUploadDocFiles(doc, fileList)}
            />
          ))}
        </div>
        {!flow.packetAssembled && (
          canEdit && !caseDone ? (
            <button
              type="button"
              disabled={busy || !requiredDocsDone}
              title={requiredDocsDone ? undefined : 'Check all required documents first (specialist letter only if applicable)'}
              onClick={() => run(() => markPacketAssembled({ opwddCase: activeCase, actorUserId: appUserId }))}
              style={{ ...primaryBtn(t, { disabled: busy || !requiredDocsDone }), width: '100%', marginTop: 10 }}
            >
              Mark packet assembled
            </button>
          ) : (
            <MetaLine t={t}>Packet not yet assembled.</MetaLine>
          )
        )}
      </StepCard>

      {/* Step 2 — Visit scheduling */}
      <StepCard
        t={t}
        number={2}
        title="Visit Scheduling"
        statusPill={flow.psychScheduled && flow.psychosocialScheduled
          ? <DonePill>Both scheduled</DonePill>
          : flow.psychScheduled || flow.psychosocialScheduled
            ? <PendingPill>1 of 2</PendingPill>
            : <IdlePill />}
      >
        {OPWDD_VISIT_TYPES.map((visit) => {
          const scheduledAt = activeCase[visit.scheduledField];
          const isPsych = visit.value === 'psychological';
          const dateVal = isPsych ? psychDate : psychosocialDate;
          const setDateVal = isPsych ? setPsychDate : setPsychosocialDate;
          return (
            <div key={visit.value} style={{ marginBottom: t.gap }}>
              <p style={{ margin: '0 0 4px', fontSize: t.fontMuted, fontWeight: 700, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>
                {visit.label}
              </p>
              {scheduledAt ? (
                <MetaLine t={t}>Scheduled for {fmtDate(scheduledAt)}</MetaLine>
              ) : canEdit && !caseDone ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="date"
                    value={dateVal}
                    onChange={(e) => setDateVal(e.target.value)}
                    style={{ ...inputStyle(t), flex: 1 }}
                  />
                  <button
                    type="button"
                    disabled={busy || !dateVal}
                    onClick={() => run(() => scheduleOpwddVisit({
                      opwddCase: activeCase, actorUserId: appUserId,
                      visitType: visit.value, scheduledFor: dateVal,
                    }))}
                    style={{ ...secondaryBtn(t), flex: 'none', padding: `${t.btnPadY}px 12px`, fontWeight: 700, opacity: !dateVal ? 0.5 : 1, cursor: !dateVal ? 'not-allowed' : 'pointer' }}
                  >
                    Mark scheduled
                  </button>
                </div>
              ) : (
                <MetaLine t={t}>Not scheduled yet.</MetaLine>
              )}
            </div>
          );
        })}
      </StepCard>

      {/* Step 3 — Visits completed */}
      <StepCard
        t={t}
        number={3}
        title="Visits Completed"
        statusPill={flow.visitsCompleted
          ? <DonePill>Both completed</DonePill>
          : flow.psychCompleted || flow.psychosocialCompleted
            ? <PendingPill>1 of 2</PendingPill>
            : <IdlePill />}
      >
        {OPWDD_VISIT_TYPES.map((visit) => {
          const completedAt = activeCase[visit.completedField];
          const scheduledAt = activeCase[visit.scheduledField];
          return (
            <div key={visit.value} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: t.fontMuted, fontWeight: 700, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>
                {visit.label}
              </span>
              {completedAt ? (
                <DonePill>{fmtDate(completedAt)}</DonePill>
              ) : canEdit && !caseDone ? (
                <button
                  type="button"
                  disabled={busy || !scheduledAt}
                  title={scheduledAt ? undefined : 'Schedule the visit first (Step 2)'}
                  onClick={() => run(() => markOpwddVisitCompleted({
                    opwddCase: activeCase, actorUserId: appUserId, visitType: visit.value,
                  }))}
                  style={{ ...secondaryBtn(t), flex: 'none', padding: `${Math.max(4, t.btnPadY - 2)}px 10px`, fontSize: t.fontMuted, fontWeight: 700, opacity: !scheduledAt ? 0.45 : 1, cursor: !scheduledAt ? 'not-allowed' : 'pointer' }}
                >
                  Mark completed
                </button>
              ) : (
                <IdlePill>Not completed</IdlePill>
              )}
            </div>
          );
        })}
      </StepCard>

      {/* ── PHASE 2 ── */}
      <PhaseHeading t={t}>Phase 2</PhaseHeading>

      {/* Step 4 — Submit to health home */}
      <StepCard
        t={t}
        number={4}
        title="Submit to Health Home"
        muted={!flow.phase1Complete && !flow.submitted}
        statusPill={flow.submitted
          ? (
            <span style={{ display: 'inline-flex', gap: 4 }}>
              <DonePill>Submitted</DonePill>
              {!flow.letterReceived && !caseDone && <PendingPill>Pending</PendingPill>}
            </span>
          )
          : <IdlePill>Not submitted</IdlePill>}
      >
        {flow.submitted ? (
          <MetaLine t={t}>
            Submitted {fmtDate(activeCase.submission_sent_at)}
            {activeCase.submitted_to_entity_name ? ` to ${activeCase.submitted_to_entity_name}` : ''}
            {submittedBy && submittedBy !== '—' ? ` by ${submittedBy}` : ''}
            {!flow.letterReceived && !caseDone ? ' — awaiting determination letter.' : ''}
          </MetaLine>
        ) : !flow.phase1Complete ? (
          <MetaLine t={t}>Complete Phase 1 (packet assembled + both visits completed) to submit.</MetaLine>
        ) : canSubmit && !caseDone ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <EntityPicker t={t} entities={entities} value={submitEntity} onChange={setSubmitEntity} disabled={busy} />
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="date"
                value={submitDate}
                onChange={(e) => setSubmitDate(e.target.value)}
                style={{ ...inputStyle(t), flex: 1 }}
              />
              <button
                type="button"
                disabled={busy || !submitEntity || !submitDate}
                onClick={() => run(() => submitToHealthhome({
                  opwddCase: activeCase, actorUserId: appUserId,
                  entity: submitEntity, submittedOn: submitDate,
                }))}
                style={{ ...primaryBtn(t, { disabled: busy || !submitEntity || !submitDate }), flex: 'none', padding: `${t.btnPadY}px 14px` }}
              >
                Mark submitted
              </button>
            </div>
          </div>
        ) : (
          <MetaLine t={t}>Awaiting submission.</MetaLine>
        )}
      </StepCard>

      {/* Step 5 — Parent letter + completion */}
      <StepCard
        t={t}
        number={5}
        title="Letter received & Completion"
        muted={!flow.submitted && !caseDone}
        statusPill={flow.completed
          ? <DonePill>Sent to Intake</DonePill>
          : letterUploaded
            ? <Pill bg="#DBEAFE" fg="#1D4ED8">Letter uploaded</Pill>
            : <IdlePill>Awaiting letter</IdlePill>}
      >
        {flow.completed ? (
          <MetaLine t={t}>
            Letter received {fmtDate(activeCase.parent_letter_received_at)} — case completed and referral sent back to Intake.
          </MetaLine>
        ) : !flow.submitted ? (
          <MetaLine t={t}>Submit the packet (Step 4) first. When the determination letter arrives from the parent, upload it here.</MetaLine>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {letterUploaded ? (
              <MetaLine t={t}>
                Letter on file ({activeCase.parent_letter_file_id}).
                {onOpenFiles && (
                  <button
                    type="button"
                    onClick={() => onOpenFiles(patient)}
                    style={{ border: 'none', background: 'none', padding: 0, marginLeft: 6, cursor: 'pointer', fontSize: t.fontMuted, fontWeight: 700, color: palette.accentBlue.hex }}
                  >
                    View files
                  </button>
                )}
              </MetaLine>
            ) : (
              <MetaLine t={t}>Upload the letter received from the parent.</MetaLine>
            )}
            {canEdit && (
              <input
                ref={letterInputRef}
                type="file"
                disabled={uploadingLetter || busy}
                onChange={(e) => handleUploadLetter(e.target.files?.[0])}
                style={{ fontSize: t.fontMuted }}
              />
            )}
            {uploadingLetter && <MetaLine t={t}>Uploading letter…</MetaLine>}
            {canConvert && (
              <button
                type="button"
                disabled={busy || uploadingLetter || !letterUploaded}
                title={letterUploaded ? undefined : 'Upload the parent letter first'}
                onClick={() => run(() => completeCaseWithParentLetter({
                  opwddCase: activeCase, referral, actorUserId: appUserId,
                  letterFileId: activeCase.parent_letter_file_id,
                }))}
                style={primaryBtn(t, { disabled: busy || uploadingLetter || !letterUploaded })}
              >
                {busy ? 'Completing…' : 'Mark case completed · send back to Intake'}
              </button>
            )}
          </div>
        )}
      </StepCard>

      {/* Close-case escape hatch */}
      {canClose && !caseDone && (
        <div style={{ marginTop: t.sectionGap }}>
          {!showClose ? (
            <button
              type="button"
              onClick={() => setShowClose(true)}
              style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontSize: t.fontMuted, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}
            >
              Close case without completing…
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={closeReason} onChange={(e) => setCloseReason(e.target.value)} style={{ ...inputStyle(t), flex: 1 }}>
                <option value="">Close reason…</option>
                {OPWDD_CLOSED_REASON_OPTIONS.filter((o) => o.value !== 'converted_to_intake').map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !closeReason}
                onClick={() => run(async () => {
                  await closeCase({ opwddCase: activeCase, actorUserId: appUserId, reason: closeReason });
                  setShowClose(false);
                })}
                style={{ ...secondaryBtn(t), flex: 'none', padding: `${t.btnPadY}px 12px`, fontWeight: 700, color: palette.primaryMagenta.hex, opacity: !closeReason ? 0.5 : 1 }}
              >
                Close case
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
