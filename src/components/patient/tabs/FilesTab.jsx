import { useState, useEffect, useRef, useMemo } from 'react';
import { useUser } from '@clerk/react';
import { getFilesByPatient, createFile, deleteFile } from '../../../api/patientFiles.js';
import { uploadToR2 } from '../../../utils/r2Upload.js';
import { updateReferral } from '../../../api/referrals.js';
import { triggerDataRefresh } from '../../../hooks/useRefreshTrigger.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { useLookups } from '../../../hooks/useLookups.js';
import PhysicianPicker from '../../physicians/PhysicianPicker.jsx';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';
import {
  OPWDD_FILE_CATEGORIES,
  OPWDD_FILE_CATEGORY,
  OPWDD_CHECKLIST_TEMPLATE,
  OPWDD_CHECKLIST_BY_KEY,
  OPWDD_REQUIREMENT_TO_CATEGORY,
  OPWDD_AUDIT_ACTION,
} from '../../../data/opwddEnums.js';
import { getChecklistItemsByReferral } from '../../../api/opwddChecklistItems.js';
import { markChecklistItemReceived } from '../../../store/opwddOrchestration.js';
import { recordActivity } from '../../../api/activityLog.js';

const CATEGORY_COLORS = {
  'F2F': { bg: hexToRgba(palette.primaryMagenta.hex, 0.1), text: palette.primaryMagenta.hex },
  'MD Orders': { bg: hexToRgba(palette.accentOrange.hex, 0.12), text: '#8B4A00' },
  'Auth Letter': { bg: hexToRgba(palette.accentGreen.hex, 0.1), text: '#3A6E00' },
  'Insurance': { bg: hexToRgba(palette.accentBlue.hex, 0.1), text: '#005B84' },
  'Discharge': { bg: hexToRgba(palette.highlightYellow.hex, 0.15), text: '#7A5F00' },
  'ID': { bg: hexToRgba(palette.backgroundDark.hex, 0.07), text: hexToRgba(palette.backgroundDark.hex, 0.6) },
  'Consent': { bg: hexToRgba(palette.backgroundDark.hex, 0.07), text: hexToRgba(palette.backgroundDark.hex, 0.6) },
  'Other': { bg: hexToRgba(palette.backgroundDark.hex, 0.06), text: hexToRgba(palette.backgroundDark.hex, 0.5) },
  // OPWDD categories share the deep-plum family since they all belong to the
  // OPWDD enrollment flow
  'OPWDD':            { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.08), text: palette.primaryDeepPlum.hex },
  'OPWDD Evaluation': { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.12), text: palette.primaryDeepPlum.hex },
  'OPWDD Identity':   { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.10), text: palette.primaryDeepPlum.hex },
  'OPWDD Insurance':  { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.10), text: palette.primaryDeepPlum.hex },
  'OPWDD Notice':     { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.12), text: palette.primaryDeepPlum.hex },
};

const STANDARD_FILE_CATEGORIES = ['F2F', 'MD Orders', 'Auth Letter', 'Insurance', 'Discharge', 'ID', 'Consent', 'Other'];
const FILE_CATEGORIES = [...STANDARD_FILE_CATEGORIES, ...OPWDD_FILE_CATEGORIES];

function isOpwddCategory(cat) {
  return OPWDD_FILE_CATEGORIES.includes(cat);
}

function formatBytes(b) {
  if (!b) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }) + ' ' + new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function getFileIcon(type, name) {
  // Always check extension first (type may be missing since Airtable field is restricted)
  const ext = (name || '').split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return 'pdf';
  if (['jpg','jpeg','png','gif','webp','svg','avif','heic'].includes(ext)) return 'image';
  if (['doc','docx','odt','rtf'].includes(ext)) return 'doc';
  if (['xls','xlsx','csv'].includes(ext)) return 'doc';
  // Fall back to MIME type if extension unclear
  if (type) {
    if (type.includes('pdf')) return 'pdf';
    if (type.includes('image')) return 'image';
    if (type.includes('word') || type.includes('document') || type.includes('spreadsheet')) return 'doc';
  }
  return 'generic';
}

function FileIconSVG({ kind }) {
  const color = kind === 'pdf' ? palette.primaryMagenta.hex
    : kind === 'image' ? palette.accentBlue.hex
    : kind === 'doc' ? '#005B84'
    : hexToRgba(palette.backgroundDark.hex, 0.4);
  return (
    <div style={{ width: 36, height: 36, borderRadius: 8, background: hexToRgba(color, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        {kind === 'image' ? (
          <>
            <rect x="3" y="3" width="18" height="18" rx="2" stroke={color} strokeWidth="1.6" />
            <circle cx="8.5" cy="8.5" r="1.5" fill={color} />
            <path d="M21 15l-5-5L5 21" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M14 2v6h6" stroke={color} strokeWidth="1.6" strokeLinejoin="round" />
            {kind === 'pdf' && <path d="M9 13h6M9 17h4" stroke={color} strokeWidth="1.4" strokeLinecap="round" />}
          </>
        )}
      </svg>
    </div>
  );
}

function PreviewModal({ file, onClose }) {
  const kind = getFileIcon(file.file_type, file.file_name);
  const url = file.r2_url?.replace(/[<>\n]/g, '').trim();

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: hexToRgba(palette.backgroundDark.hex, 0.7),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{
        background: palette.backgroundLight.hex, borderRadius: 14,
        width: '100%', maxWidth: 800, maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.3)}`,
        overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: `1px solid var(--color-border)` }}>
          <p style={{ fontSize: 14, fontWeight: 650, color: palette.backgroundDark.hex, wordBreak: 'break-all' }}>{file.file_name}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            {url && (
              <a href={url} download={file.file_name} style={{ padding: '6px 14px', borderRadius: 7, background: hexToRgba(palette.accentBlue.hex, 0.1), border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.25)}`, fontSize: 12, fontWeight: 650, color: palette.accentBlue.hex, textDecoration: 'none' }}>
                Download
              </a>
            )}
            <button onClick={onClose} style={{ padding: '6px 12px', borderRadius: 7, background: hexToRgba(palette.backgroundDark.hex, 0.07), border: `1px solid var(--color-border)`, fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>
              Close
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          {!url ? (
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>No preview URL available.</p>
          ) : kind === 'image' ? (
            <img src={url} alt={file.file_name} style={{ maxWidth: '100%', maxHeight: '60vh', objectFit: 'contain', borderRadius: 8 }} />
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ width: 56, height: 56, borderRadius: 12, background: hexToRgba(palette.accentBlue.hex, 0.1), display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={palette.accentBlue.hex} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke={palette.accentBlue.hex} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <p style={{ fontSize: 14, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 6 }}>{file.file_name}</p>
              <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 20 }}>
                {kind === 'pdf' ? 'PDF preview opens in a new tab' : 'No inline preview for this file type'}
              </p>
              <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 24px', borderRadius: 8, background: palette.accentBlue.hex, color: palette.backgroundLight.hex, fontSize: 13, fontWeight: 650, textDecoration: 'none' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Open {kind === 'pdf' ? 'PDF' : 'File'}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FilesTab({ patient, referral, readOnly = false }) {
  const { user } = useUser();
  const { appUserId, appUserName } = useCurrentAppUser();
  const { resolveUser, resolvePhysician } = useLookups();
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [preview, setPreview] = useState(null);
  // Staging state — file is held here until user confirms upload with options
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingCategory, setPendingCategory] = useState('Other');
  const [pendingPhysician, setPendingPhysician] = useState(null);
  const [f2fDate, setF2fDate] = useState('');
  const [f2fDatePrefilled, setF2fDatePrefilled] = useState(false);
  // OPWDD-specific staging (only used when category is an OPWDD_* category)
  const [pendingDocumentSubtype, setPendingDocumentSubtype] = useState('');
  const [pendingDocumentDate, setPendingDocumentDate] = useState('');
  const [pendingDocumentValidThrough, setPendingDocumentValidThrough] = useState('');
  const [pendingOpwddChecklistItemId, setPendingOpwddChecklistItemId] = useState('');
  const [opwddChecklistItems, setOpwddChecklistItems] = useState([]);
  // Filter + grouping state for the file list
  const [categoryFilter, setCategoryFilter] = useState('all'); // 'all' | 'F2F' | 'MD Orders' | 'OPWDD' (family) | specific cat
  const [search, setSearch] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const inputRef = useRef(null);
  const { can } = usePermissions();

  // Load OPWDD checklist items for this referral so the upload form can
  // offer a "satisfies requirement" picker that writes back
  // `satisfying_file_id` on the chosen checklist row.
  useEffect(() => {
    if (!referral?.id) { setOpwddChecklistItems([]); return; }
    getChecklistItemsByReferral(referral.id)
      .then((records) => setOpwddChecklistItems(records.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => setOpwddChecklistItems([]));
  }, [referral?.id]);

  const r2Configured = !!import.meta.env.VITE_R2_WORKER_URL;

  async function handleDeleteFile(file) {
    if (!window.confirm(`Delete "${file.file_name || 'this file'}"? This cannot be undone.`)) return;
    try {
      await deleteFile(file._id);
      setFiles((prev) => prev.filter((f) => f._id !== file._id));
    } catch { /* silent */ }
  }

  useEffect(() => {
    if (!patient?.id) return;
    setLoading(true);
    getFilesByPatient(patient.id)
      .then((records) => setFiles(records.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [patient?.id]);

  function stageFile(fileList) {
    if (!can(PERMISSION_KEYS.FILE_UPLOAD)) return;
    if (!fileList?.length || uploading) return;
    setPendingFile(fileList[0]);
    setPendingCategory('Other');
    setPendingPhysician(null);
    setF2fDate('');
    setF2fDatePrefilled(false);
    setPendingDocumentSubtype('');
    setPendingDocumentDate('');
    setPendingDocumentValidThrough('');
    setPendingOpwddChecklistItemId('');
    setUploadError(null);
  }

  function cancelStaging() {
    setPendingFile(null);
    setPendingPhysician(null);
    setF2fDate('');
    setF2fDatePrefilled(false);
    setPendingDocumentSubtype('');
    setPendingDocumentDate('');
    setPendingDocumentValidThrough('');
    setPendingOpwddChecklistItemId('');
    if (inputRef.current) inputRef.current.value = '';
  }

  async function confirmUpload() {
    if (!can(PERMISSION_KEYS.FILE_UPLOAD)) return;
    if (!pendingFile || uploading) return;
    setUploading(true);
    setUploadError(null);
    setUploadProgress(`Uploading ${pendingFile.name}…`);

    try {
      const { r2Key, r2Url } = await uploadToR2(pendingFile, patient.id);

      const linkedChecklistItem = pendingOpwddChecklistItemId
        ? opwddChecklistItems.find((i) => i._id === pendingOpwddChecklistItemId)
        : null;

      const baseFields = {
        id: `file_${Date.now()}`,
        patient_id: patient.id,
        uploaded_by_id: appUserId || appUserName || 'unknown',
        file_name: pendingFile.name,
        file_size: pendingFile.size,
        r2_key: r2Key,
        r2_url: r2Url,
        category: pendingCategory,
        created_at: new Date().toISOString(),
        ...(referral?.id ? { referral_id: referral.id } : {}),
        ...(pendingCategory === 'F2F' && f2fDate ? { f2f_visit_date: f2fDate } : {}),
        // OPWDD metadata — only written when the category belongs to the
        // OPWDD family, matching the schema extension on Files
        ...(isOpwddCategory(pendingCategory) && linkedChecklistItem?.opwdd_case_id
          ? { opwdd_case_id: linkedChecklistItem.opwdd_case_id }
          : {}),
        ...(isOpwddCategory(pendingCategory) && pendingDocumentSubtype
          ? { document_subtype: pendingDocumentSubtype }
          : {}),
        ...(isOpwddCategory(pendingCategory) && pendingDocumentDate
          ? { document_date: new Date(pendingDocumentDate).toISOString() }
          : {}),
        ...(isOpwddCategory(pendingCategory) && pendingDocumentValidThrough
          ? { document_valid_through: new Date(pendingDocumentValidThrough).toISOString() }
          : {}),
      };

      // Try with physician_id first. If Airtable rejects it (field not yet
      // added to the Files table), fall back to saving without it.
      let created;
      if (pendingPhysician?.id) {
        try {
          created = await createFile({ ...baseFields, physician_id: pendingPhysician.id });
        } catch (e) {
          if (e.message?.includes('Unknown field name')) {
            created = await createFile(baseFields);
          } else {
            throw e;
          }
        }
      } else {
        created = await createFile(baseFields);
      }

      setFiles((prev) => [{ _id: created.id, ...created.fields, _justUploaded: true }, ...prev]);

      // If the upload satisfies an OPWDD checklist item, link the file and
      // flip the item to "received" (status + received_at + satisfying_file_id).
      // Failure is non-fatal — the user can link the file later from the
      // OPWDD workspace.
      if (isOpwddCategory(pendingCategory) && linkedChecklistItem) {
        try {
          await markChecklistItemReceived({
            item: linkedChecklistItem,
            receivedByUserId: appUserId,
            satisfyingFileId: created.fields?.id || created.id,
            actorUserId: appUserId,
          });
          await recordActivity({
            actorUserId: appUserId,
            action: OPWDD_AUDIT_ACTION.FILE_LINKED,
            patientId:  patient.id,
            referralId: referral?.id,
            detail: `File linked to OPWDD checklist item: ${linkedChecklistItem.requirement_label || linkedChecklistItem.requirement_key}.`,
            metadata: { fileId: created.fields?.id || created.id, requirementKey: linkedChecklistItem.requirement_key, caseId: linkedChecklistItem.opwdd_case_id },
          }).catch(() => {});
        } catch (err) {
          console.warn('OPWDD checklist link failed', err);
        }
      }

      // If category is F2F, the visit date drives the 90-day expiration clock
      if (pendingCategory === 'F2F' && f2fDate && referral?._id) {
        const visitDate = new Date(f2fDate);
        const expiration = new Date(visitDate);
        expiration.setDate(expiration.getDate() + 90);
        await updateReferral(referral._id, {
          f2f_date: visitDate.toISOString(),
          f2f_expiration: expiration.toISOString(),
        }).catch(() => {});
        triggerDataRefresh();
      }

      setPendingFile(null);
      setPendingPhysician(null);
      setF2fDate('');
      setF2fDatePrefilled(false);
      setPendingDocumentSubtype('');
      setPendingDocumentDate('');
      setPendingDocumentValidThrough('');
      setPendingOpwddChecklistItemId('');
      setUploadProgress(null);
      if (inputRef.current) inputRef.current.value = '';
      triggerDataRefresh();
    } catch (err) {
      setUploadError(err.message);
      setUploadProgress(null);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Drop zone — only shown when no pending file */}
      {!readOnly && can(PERMISSION_KEYS.FILE_UPLOAD) && !pendingFile && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); stageFile(e.dataTransfer.files); }}
          onClick={() => r2Configured && inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.15)}`,
            borderRadius: 10, padding: '20px 16px', textAlign: 'center', marginBottom: 16,
            background: dragOver ? hexToRgba(palette.primaryMagenta.hex, 0.04) : hexToRgba(palette.backgroundDark.hex, 0.02),
            transition: 'all 0.15s',
            cursor: r2Configured ? 'pointer' : 'default',
          }}
        >
          <input ref={inputRef} type="file" style={{ display: 'none' }} onChange={(e) => stageFile(e.target.files)} />
          {r2Configured ? (
            <>
              <p style={{ fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 4 }}>
                Drop file here or click to upload
              </p>
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                Secure upload
              </p>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 4 }}>
                File uploads unavailable
              </p>
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.38), lineHeight: 1.5 }}>
                The file upload worker is not reachable. Contact your administrator.
              </p>
            </>
          )}
        </div>
      )}

      {/* Staging panel — shown after a file is selected, before uploading */}
      {!readOnly && pendingFile && !uploading && (
        <div style={{ border: `1px solid var(--color-border)`, borderRadius: 10, padding: '16px', marginBottom: 16, background: hexToRgba(palette.backgroundDark.hex, 0.02) }}>
          {/* File name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid var(--color-border)` }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={palette.accentBlue.hex} strokeWidth="1.6" strokeLinejoin="round"/><path d="M14 2v6h6" stroke={palette.accentBlue.hex} strokeWidth="1.6" strokeLinejoin="round"/></svg>
            <span style={{ fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex, flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{pendingFile.name}</span>
            <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), flexShrink: 0 }}>
              {pendingFile.size < 1048576 ? `${(pendingFile.size / 1024).toFixed(1)} KB` : `${(pendingFile.size / 1048576).toFixed(1)} MB`}
            </span>
          </div>

          {/* Category */}
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 8 }}>Category</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: isOpwddCategory(pendingCategory) ? 12 : 16 }}>
            {FILE_CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => {
                  setPendingCategory(cat);
                  if (cat === 'F2F') {
                    if (referral?.f2f_date) {
                      setF2fDate(new Date(referral.f2f_date).toISOString().slice(0, 10));
                      setF2fDatePrefilled(true);
                    } else {
                      setF2fDate('');
                      setF2fDatePrefilled(false);
                    }
                  } else {
                    setF2fDate('');
                    setF2fDatePrefilled(false);
                  }
                  // Clear OPWDD staging fields when switching to a non-OPWDD
                  // category, and pre-pick a subtype suggestion otherwise.
                  if (!isOpwddCategory(cat)) {
                    setPendingDocumentSubtype('');
                    setPendingOpwddChecklistItemId('');
                  }
                }}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: `1px solid var(--color-border)`,
                  fontSize: 11.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.12s',
                  background: pendingCategory === cat
                    ? (isOpwddCategory(cat) ? palette.primaryDeepPlum.hex : palette.primaryMagenta.hex)
                    : 'none',
                  color: pendingCategory === cat ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6),
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* OPWDD metadata — only when an OPWDD category is selected */}
          {isOpwddCategory(pendingCategory) && (
            <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8, background: hexToRgba(palette.primaryDeepPlum.hex, 0.05), border: `1px solid ${hexToRgba(palette.primaryDeepPlum.hex, 0.2)}` }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: palette.primaryDeepPlum.hex, marginBottom: 8 }}>
                OPWDD Document Details
              </p>

              {/* Satisfies which checklist requirement? (drives linking + subtype) */}
              {opwddChecklistItems.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 3 }}>
                    Satisfies checklist item (optional)
                  </p>
                  <select
                    value={pendingOpwddChecklistItemId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setPendingOpwddChecklistItemId(id);
                      const chosen = opwddChecklistItems.find((i) => i._id === id);
                      if (chosen) {
                        setPendingDocumentSubtype(chosen.requirement_key || '');
                        const suggestedCategory = OPWDD_REQUIREMENT_TO_CATEGORY[chosen.requirement_key];
                        if (suggestedCategory && !OPWDD_FILE_CATEGORIES.includes(pendingCategory)) {
                          setPendingCategory(suggestedCategory);
                        } else if (suggestedCategory) {
                          setPendingCategory(suggestedCategory);
                        }
                        // Auto-compute valid-through for evaluation docs
                        const tmpl = OPWDD_CHECKLIST_BY_KEY[chosen.requirement_key];
                        if (tmpl?.validityYears && pendingDocumentDate) {
                          const d = new Date(pendingDocumentDate);
                          d.setFullYear(d.getFullYear() + tmpl.validityYears);
                          setPendingDocumentValidThrough(d.toISOString().slice(0, 10));
                        }
                      }
                    }}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: `1px solid ${hexToRgba(palette.primaryDeepPlum.hex, 0.3)}`, fontSize: 12.5, background: palette.backgroundLight.hex, fontFamily: 'inherit', outline: 'none' }}
                  >
                    <option value="">— Don't link to a checklist item —</option>
                    {opwddChecklistItems.map((i) => (
                      <option key={i._id} value={i._id}>
                        {i.requirement_label || i.requirement_key} — {i.status}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Document subtype (mirrors requirement_key singleSelect) */}
              <div style={{ marginBottom: 10 }}>
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 3 }}>
                  Document type
                </p>
                <select
                  value={pendingDocumentSubtype}
                  onChange={(e) => setPendingDocumentSubtype(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: `1px solid ${hexToRgba(palette.primaryDeepPlum.hex, 0.3)}`, fontSize: 12.5, background: palette.backgroundLight.hex, fontFamily: 'inherit', outline: 'none' }}
                >
                  <option value="">— Select —</option>
                  {OPWDD_CHECKLIST_TEMPLATE.map((tmpl) => (
                    <option key={tmpl.key} value={tmpl.key}>{tmpl.label}</option>
                  ))}
                </select>
              </div>

              {/* Document date + valid-through (side by side) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 3 }}>
                    Document date
                  </p>
                  <input
                    type="date"
                    value={pendingDocumentDate}
                    onChange={(e) => {
                      setPendingDocumentDate(e.target.value);
                      // auto-compute valid through if the subtype carries validity
                      const tmpl = OPWDD_CHECKLIST_BY_KEY[pendingDocumentSubtype];
                      if (e.target.value && tmpl?.validityYears) {
                        const d = new Date(e.target.value);
                        d.setFullYear(d.getFullYear() + tmpl.validityYears);
                        setPendingDocumentValidThrough(d.toISOString().slice(0, 10));
                      }
                    }}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: `1px solid ${hexToRgba(palette.primaryDeepPlum.hex, 0.3)}`, fontSize: 12.5, background: palette.backgroundLight.hex, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <div>
                  <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 3 }}>
                    Valid through
                  </p>
                  <input
                    type="date"
                    value={pendingDocumentValidThrough}
                    onChange={(e) => setPendingDocumentValidThrough(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: `1px solid ${hexToRgba(palette.primaryDeepPlum.hex, 0.3)}`, fontSize: 12.5, background: palette.backgroundLight.hex, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Date of Visit — required when F2F category is selected */}
          {pendingCategory === 'F2F' && (
            <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8, background: hexToRgba(palette.primaryMagenta.hex, 0.05), border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.2)}` }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: palette.primaryMagenta.hex, marginBottom: 4 }}>
                Date of Visit <span style={{ color: palette.primaryMagenta.hex }}>*</span>
              </p>

              {f2fDatePrefilled ? (
                <div>
                  <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 8 }}>
                    This referral already has a visit date on record. Confirm or adjust below.
                  </p>
                  <input
                    type="date"
                    value={f2fDate}
                    onChange={(e) => { setF2fDate(e.target.value); }}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: `1px solid ${palette.primaryMagenta.hex}`, fontSize: 13, color: palette.backgroundDark.hex, background: palette.backgroundLight.hex, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                  />
                  {f2fDate && (
                    <p style={{ fontSize: 11.5, color: palette.accentGreen.hex, marginTop: 6, fontWeight: 600 }}>
                      Expires {new Date(new Date(f2fDate).setDate(new Date(f2fDate).getDate() + 90)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 8 }}>
                    When did the physician visit occur? This starts the 90-day F2F expiration clock.
                  </p>
                  <input
                    type="date"
                    value={f2fDate}
                    onChange={(e) => setF2fDate(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: `1px solid ${f2fDate ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.15)}`, fontSize: 13, color: palette.backgroundDark.hex, background: palette.backgroundLight.hex, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                  />
                  {f2fDate && (
                    <p style={{ fontSize: 11.5, color: palette.accentGreen.hex, marginTop: 6, fontWeight: 600 }}>
                      Expires {new Date(new Date(f2fDate).setDate(new Date(f2fDate).getDate() + 90)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                  {!f2fDate && (
                    <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4, fontWeight: 550 }}>
                      Required — the 90-day clock starts from the date of visit
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Physician association */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>Associated Physician</p>
              {pendingPhysician && (
                <button onClick={() => setPendingPhysician(null)} style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  Clear
                </button>
              )}
            </div>
            <PhysicianPicker
              physicianId={pendingPhysician?.id || null}
              onChange={setPendingPhysician}
              compact
            />
            {!pendingPhysician && (
              <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35), marginTop: 5 }}>
                Optional
              </p>
            )}
          </div>

          {uploadError && (
            <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 7, background: hexToRgba(palette.primaryMagenta.hex, 0.08), border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.25)}`, fontSize: 12.5, color: palette.primaryMagenta.hex }}>
              {uploadError}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {pendingCategory === 'F2F' && !f2fDate && (
              <p style={{ flex: 1, fontSize: 11.5, fontWeight: 600, color: palette.primaryMagenta.hex }}>
                Enter a date of visit to upload
              </p>
            )}
            <button
              onClick={confirmUpload}
              disabled={pendingCategory === 'F2F' && !f2fDate}
              style={{ padding: '8px 20px', borderRadius: 7, background: (pendingCategory === 'F2F' && !f2fDate) ? hexToRgba(palette.backgroundDark.hex, 0.1) : palette.primaryDeepPlum.hex, border: 'none', fontSize: 13, fontWeight: 650, color: (pendingCategory === 'F2F' && !f2fDate) ? hexToRgba(palette.backgroundDark.hex, 0.35) : '#fff', cursor: (pendingCategory === 'F2F' && !f2fDate) ? 'not-allowed' : 'pointer' }}
            >
              Upload
            </button>
            <button
              onClick={cancelStaging}
              style={{ padding: '8px 14px', borderRadius: 7, border: `1px solid var(--color-border)`, background: 'none', fontSize: 12.5, fontWeight: 550, color: hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Upload progress */}
      {!readOnly && uploading && uploadProgress && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: hexToRgba(palette.primaryMagenta.hex, 0.06), fontSize: 13, color: palette.primaryMagenta.hex, fontWeight: 600 }}>
          {uploadProgress}
        </div>
      )}

      {uploadError && !pendingFile && (
        <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 8, background: hexToRgba(palette.primaryMagenta.hex, 0.08), border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.25)}`, fontSize: 12.5, color: palette.primaryMagenta.hex, lineHeight: 1.5 }}>
          {uploadError}
        </div>
      )}

      {loading ? (
        <LoadingState message="Loading files..." size="small" />
      ) : files.length === 0 ? (
        <p style={{ textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), padding: '24px 0', fontStyle: 'italic' }}>
          No files uploaded yet.
        </p>
      ) : (
        <GroupedFileList
          files={files}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          search={search}
          setSearch={setSearch}
          collapsedGroups={collapsedGroups}
          toggleGroup={(id) => setCollapsedGroups((prev) => ({ ...prev, [id]: !prev[id] }))}
          onPreview={setPreview}
          onDelete={readOnly ? undefined : handleDeleteFile}
          resolveUser={resolveUser}
          resolvePhysician={resolvePhysician}
          appUserName={appUserName}
        />
      )}

      {preview && <PreviewModal file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

// ── Grouped file list — category filter pills + collapsible sections ────────
// Files are bucketed into the following ordered groups:
//   1. OPWDD (all OPWDD_* categories merged, sub-grouped by subtype)
//   2. F2F / MD Orders
//   3. Insurance / ID / Consent
//   4. Authorization (Auth Letter)
//   5. Discharge
//   6. Other / Uncategorized
// A simple text search narrows within the current filter.
function GroupedFileList({
  files, categoryFilter, setCategoryFilter, search, setSearch,
  collapsedGroups, toggleGroup,
  onPreview, onDelete, resolveUser, resolvePhysician, appUserName,
}) {
  const groupDefs = useMemo(() => ([
    {
      id: 'opwdd',
      label: 'OPWDD Enrollment',
      match: (file) => isOpwddCategory(file.category),
      accent: palette.primaryDeepPlum.hex,
      subGroupBy: (file) => OPWDD_CHECKLIST_BY_KEY[file.document_subtype]?.label
        || file.document_subtype
        || 'Other OPWDD',
    },
    {
      id: 'clinical',
      label: 'F2F / MD Orders',
      match: (file) => file.category === 'F2F' || file.category === 'MD Orders',
      accent: palette.primaryMagenta.hex,
    },
    {
      id: 'insurance_id',
      label: 'Insurance & ID',
      match: (file) => ['Insurance', 'ID', 'Consent'].includes(file.category),
      accent: palette.accentBlue.hex,
    },
    {
      id: 'auth',
      label: 'Authorization',
      match: (file) => file.category === 'Auth Letter',
      accent: palette.accentGreen.hex,
    },
    {
      id: 'discharge',
      label: 'Discharge',
      match: (file) => file.category === 'Discharge',
      accent: '#7A5F00',
    },
    {
      id: 'other',
      label: 'Other / Uncategorized',
      match: (file) => !file.category || file.category === 'Other',
      accent: hexToRgba(palette.backgroundDark.hex, 0.5),
    },
  ]), []);

  // Filter pills only show for non-empty buckets + always show "All"
  const filterOptions = useMemo(() => {
    const opts = [{ id: 'all', label: 'All', count: files.length }];
    for (const g of groupDefs) {
      const count = files.filter(g.match).length;
      if (count > 0) opts.push({ id: g.id, label: g.label, count, accent: g.accent });
    }
    return opts;
  }, [files, groupDefs]);

  // Apply filter + search
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter((f) => {
      if (categoryFilter !== 'all') {
        const g = groupDefs.find((gg) => gg.id === categoryFilter);
        if (!g || !g.match(f)) return false;
      }
      if (q) {
        const hay = [f.file_name, f.category, f.document_subtype].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [files, categoryFilter, search, groupDefs]);

  // Sort remaining files within each group by newest first
  const groups = useMemo(() => {
    return groupDefs
      .map((g) => ({
        ...g,
        items: filtered.filter(g.match).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
      }))
      .filter((g) => g.items.length > 0);
  }, [groupDefs, filtered]);

  return (
    <div>
      {/* Filter pills + search */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {filterOptions.map((opt) => {
          const active = categoryFilter === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => setCategoryFilter(opt.id)}
              style={{
                padding: '4px 10px', borderRadius: 14, fontSize: 11.5, fontWeight: 650, cursor: 'pointer',
                border: `1px solid ${active ? (opt.accent || palette.backgroundDark.hex) : 'var(--color-border)'}`,
                background: active ? (opt.accent || palette.backgroundDark.hex) : palette.backgroundLight.hex,
                color: active ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6),
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}
            >
              {opt.label}
              <span style={{ fontSize: 10.5, opacity: 0.8 }}>{opt.count}</span>
            </button>
          );
        })}
        <input
          type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files…"
          style={{ marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, border: `1px solid var(--color-border)`, fontSize: 12, width: 140, outline: 'none', fontFamily: 'inherit' }}
        />
      </div>

      {groups.length === 0 && (
        <p style={{ textAlign: 'center', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), padding: '16px 0', fontStyle: 'italic' }}>
          No files match the current filter.
        </p>
      )}

      {groups.map((group) => {
        const collapsed = !!collapsedGroups[group.id];
        return (
          <div key={group.id} style={{ marginBottom: 10 }}>
            {/* Group header */}
            <button
              onClick={() => toggleGroup(group.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                background: hexToRgba(group.accent, 0.06),
                border: `1px solid ${hexToRgba(group.accent, 0.2)}`,
                borderRadius: 7, fontSize: 11.5, fontWeight: 700, color: group.accent,
                textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 11, opacity: 0.7 }}>{collapsed ? '▸' : '▾'}</span>
              <span style={{ flex: 1, textAlign: 'left' }}>{group.label}</span>
              <span style={{ fontSize: 10.5, opacity: 0.7 }}>{group.items.length}</span>
            </button>

            {/* Group body */}
            {!collapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 5 }}>
                {group.subGroupBy ? (
                  // OPWDD: further sub-group by document subtype
                  Object.entries(
                    group.items.reduce((acc, f) => {
                      const key = group.subGroupBy(f);
                      (acc[key] = acc[key] || []).push(f);
                      return acc;
                    }, {}),
                  ).map(([subLabel, subFiles]) => (
                    <div key={subLabel}>
                      <p style={{ fontSize: 10.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.5), padding: '2px 4px 2px 14px', marginTop: 4 }}>
                        {subLabel} <span style={{ opacity: 0.65 }}>· {subFiles.length}</span>
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {subFiles.map((file) => (
                          <FileRow key={file._id} file={file}
                            onPreview={onPreview} onDelete={onDelete}
                            resolveUser={resolveUser} resolvePhysician={resolvePhysician}
                            appUserName={appUserName} />
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  group.items.map((file) => (
                    <FileRow key={file._id} file={file}
                      onPreview={onPreview} onDelete={onDelete}
                      resolveUser={resolveUser} resolvePhysician={resolvePhysician}
                      appUserName={appUserName} />
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FileRow({ file, onPreview, onDelete, resolveUser, resolvePhysician, appUserName }) {
  const kind = getFileIcon(file.file_type, file.file_name);
  const catColors = CATEGORY_COLORS[file.category] || CATEGORY_COLORS['Other'];
  const cleanUrl = file.r2_url?.replace(/[<>\n]/g, '').trim();
  const canPreview = !!cleanUrl;
  const physicianName = file.physician_id ? resolvePhysician?.(file.physician_id) : null;
  const opwddSubtypeLabel = file.document_subtype
    ? OPWDD_CHECKLIST_BY_KEY[file.document_subtype]?.label || file.document_subtype
    : null;
  const validThrough = file.document_valid_through ? new Date(file.document_valid_through) : null;
  const isExpired = validThrough && validThrough.getTime() < Date.now();

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        borderRadius: 7, border: `1px solid var(--color-border)`,
        background: palette.backgroundLight.hex, transition: 'background 0.12s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.025))}
      onMouseLeave={(e) => (e.currentTarget.style.background = palette.backgroundLight.hex)}
    >
      <FileIconSVG kind={kind} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 550, color: palette.backgroundDark.hex, wordBreak: 'break-word', lineHeight: 1.3 }}>
          {file.file_name || 'Unnamed'}
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 3, flexWrap: 'wrap', alignItems: 'center' }}>
          {file.category && (
            <span style={{ fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: catColors.bg, color: catColors.text }}>
              {file.category}
            </span>
          )}
          {opwddSubtypeLabel && (
            <span style={{ fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: hexToRgba(palette.primaryDeepPlum.hex, 0.08), color: palette.primaryDeepPlum.hex }}>
              {opwddSubtypeLabel}
            </span>
          )}
          {validThrough && (
            <span style={{ fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: isExpired ? hexToRgba(palette.primaryMagenta.hex, 0.08) : hexToRgba(palette.accentGreen.hex, 0.12), color: isExpired ? palette.primaryMagenta.hex : '#15803d' }}>
              {isExpired ? 'Expired ' : 'Valid through '}{validThrough.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
          {physicianName && physicianName !== '—' && (
            <span style={{ fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: hexToRgba(palette.primaryDeepPlum.hex, 0.08), color: palette.primaryDeepPlum.hex }}>
              Dr. {physicianName}
            </span>
          )}
          {file.file_size && (
            <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{formatBytes(file.file_size)}</span>
          )}
        </div>
        <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35), marginTop: 2 }}>
          Uploaded {formatDateTime(file.created_at)}
          {file.uploaded_by_id ? ` · ${resolveUser(file.uploaded_by_id)}` : file._justUploaded ? ` · ${appUserName}` : ''}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {canPreview && (
          <button
            onClick={() => onPreview(file)}
            style={{
              padding: '5px 11px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: hexToRgba(palette.primaryDeepPlum.hex, 0.07),
              border: `1px solid ${hexToRgba(palette.primaryDeepPlum.hex, 0.15)}`,
              color: palette.primaryDeepPlum.hex, transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.12))}
            onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryDeepPlum.hex, 0.07))}
          >
            Preview
          </button>
        )}
        {canPreview && (
          <a
            href={cleanUrl}
            download={file.file_name}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '5px 11px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: hexToRgba(palette.accentBlue.hex, 0.1),
              border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.25)}`,
              color: palette.accentBlue.hex, textDecoration: 'none',
              display: 'flex', alignItems: 'center',
            }}
          >
            Download
          </a>
        )}
        {onDelete && (
          <button
            onClick={() => onDelete(file)}
            title="Delete file"
            style={{
              padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: hexToRgba(palette.primaryMagenta.hex, 0.08),
              border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.2)}`,
              color: palette.primaryMagenta.hex, transition: 'background 0.12s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryMagenta.hex, 0.15))}
            onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryMagenta.hex, 0.08))}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
