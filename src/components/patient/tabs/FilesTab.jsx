import { useState, useEffect, useRef, useMemo } from 'react';
import { useUser } from '@clerk/react';
import { fetchFilesForChart, createFile, updateFile, deleteFile } from '../../../api/patientFiles.js';
import { uploadToR2, openSignedFile } from '../../../utils/r2Upload.js';
import { updateReferral } from '../../../api/referrals.js';
import { updateReferralOptimistic } from '../../../store/mutations.js';
import { mergeEntities, removeEntity, updateEntity, useCareStore } from '../../../store/careStore.js';
import { triggerDataRefresh } from '../../../hooks/useRefreshTrigger.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { useLookups } from '../../../hooks/useLookups.js';
import { maybeClearDocumentationDeferred } from '../../../utils/documentationDeferred.js';
import { notifyPostSocF2fUploaded } from '../../../utils/postSocF2fUploadNotify.js';
import {
  filesForPatientFromStore,
  mergeFileLists,
  normalizeFileRecord,
} from '../../../utils/patientFilesFromStore.js';
import PhysicianPicker from '../../physicians/PhysicianPicker.jsx';
import LoadingState from '../../common/LoadingState.jsx';
import FilePreviewModal from '../../common/FilePreviewModal.jsx';
import FileSourceProviderBadge from '../../common/FileSourceProviderBadge.jsx';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
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
import {
  fmtCalendarDate,
  toCalendarDateInput,
  addCalendarDays,
  parseCalendarDate,
  toCalendarDateString,
  daysUntilCalendarDate,
  todayCalendarDate,
} from '../../../utils/dateFormat.js';
import { useIsMobile } from '../../../hooks/useIsMobile.js';

const CATEGORY_COLORS = {
  'F2F': { bg: hexToRgba(palette.primaryMagenta.hex, 0.1), text: palette.primaryMagenta.hex },
  'MD Orders': { bg: hexToRgba(palette.accentOrange.hex, 0.12), text: '#8B4A00' },
  'Auth Letter': { bg: hexToRgba(palette.accentGreen.hex, 0.1), text: '#3A6E00' },
  'Insurance': { bg: hexToRgba(palette.accentBlue.hex, 0.1), text: '#005B84' },
  'Facesheet': { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.08), text: palette.primaryDeepPlum.hex },
  'Discharge': { bg: hexToRgba(palette.highlightYellow.hex, 0.15), text: '#7A5F00' },
  'ID': { bg: hexToRgba(palette.backgroundDark.hex, 0.07), text: hexToRgba(palette.backgroundDark.hex, 0.6) },
  'Consent': { bg: hexToRgba(palette.backgroundDark.hex, 0.07), text: hexToRgba(palette.backgroundDark.hex, 0.6) },
  'Medications': { bg: hexToRgba(palette.accentGreen.hex, 0.12), text: '#3A6E00' },
  'Progress Notes': { bg: hexToRgba(palette.accentBlue.hex, 0.12), text: '#005B84' },
  'Miscellaneous': { bg: hexToRgba(palette.backgroundDark.hex, 0.06), text: hexToRgba(palette.backgroundDark.hex, 0.5) },
  'Other': { bg: hexToRgba(palette.backgroundDark.hex, 0.06), text: hexToRgba(palette.backgroundDark.hex, 0.5) },
  // OPWDD categories share the deep-plum family since they all belong to the
  // OPWDD enrollment flow
  'OPWDD':            { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.08), text: palette.primaryDeepPlum.hex },
  'OPWDD Evaluation': { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.12), text: palette.primaryDeepPlum.hex },
  'OPWDD Identity':   { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.10), text: palette.primaryDeepPlum.hex },
  'OPWDD Insurance':  { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.10), text: palette.primaryDeepPlum.hex },
  'OPWDD Notice':     { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.12), text: palette.primaryDeepPlum.hex },
};

const STANDARD_FILE_CATEGORIES = ['F2F', 'MD Orders', 'Auth Letter', 'Insurance', 'Facesheet', 'Discharge', 'ID', 'Consent', 'Medications', 'Progress Notes', 'Miscellaneous', 'Other'];
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

export default function FilesTab({ patient, referral, readOnly = false }) {
  const { user } = useUser();
  const { appUserId, appUserName } = useCurrentAppUser();
  const { resolveUser, resolvePhysician } = useLookups();
  const { openFileBeside, sideFile } = usePatientDrawer();
  const storeFiles = useCareStore((s) => s.files);
  const storePatients = useCareStore((s) => s.patients);
  const storeReferrals = useCareStore((s) => s.referrals);
  const isMobile = useIsMobile();
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
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
  const [archivedOpen, setArchivedOpen] = useState(false);
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

  const r2Configured = !!(import.meta.env.VITE_FILES_API_URL || import.meta.env.VITE_R2_WORKER_URL);

  async function handleDeleteFile(file) {
    if (!window.confirm(`Delete "${file.file_name || 'this file'}"? This cannot be undone.\n\nIf the document was just superseded (e.g. a replaced F2F), use Archive instead — archived files are kept and can be restored.`)) return;
    try {
      await deleteFile(file._id);
      removeEntity('files', file._id);
    } catch { /* silent */ }
  }

  // Soft-archive: the file is NOT deleted — it moves to the Archived section
  // below, stays viewable/downloadable, and can be restored. Used when a
  // document is superseded (e.g. Clinical bounced an F2F and a new one is
  // uploaded).
  async function handleArchiveFile(file) {
    const reason = window.prompt(
      `Archive "${file.file_name || 'this file'}"?\n\nThe file is kept and can be restored — it just moves to the Archived section.\n\nOptional reason (e.g. "F2F rejected by Clinical, replaced"):`,
      '',
    );
    if (reason === null) return; // cancelled
    const fields = {
      archived_at: new Date().toISOString(),
      archived_by_id: appUserId || 'unknown',
      archived_reason: reason.trim() || null,
      updated_at: new Date().toISOString(),
    };
    try {
      await updateFile(file._id, fields);
      updateEntity('files', file._id, fields);
    } catch (err) {
      setUploadError(`Could not archive file: ${err.message}`);
    }
  }

  async function handleRestoreFile(file) {
    const fields = {
      archived_at: null,
      archived_by_id: null,
      archived_reason: null,
      updated_at: new Date().toISOString(),
    };
    try {
      await updateFile(file._id, fields);
      updateEntity('files', file._id, fields);
    } catch (err) {
      setUploadError(`Could not restore file: ${err.message}`);
    }
  }

  const storeList = useMemo(
    () => filesForPatientFromStore(storeFiles, patient, referral, {
      patients: storePatients,
      referrals: storeReferrals,
    }),
    [storeFiles, patient, referral, storePatients, storeReferrals],
  );

  // A file open beside this drawer belongs on this chart even if ids don't match.
  const files = useMemo(
    () => mergeFileLists(storeList, sideFile ? [sideFile] : []),
    [storeList, sideFile],
  );

  useEffect(() => {
    if (!patient?.id && !patient?._id) return;
    let cancelled = false;
    const extras = { patients: useCareStore.getState().patients, referrals: useCareStore.getState().referrals };
    const alreadyHave = filesForPatientFromStore(useCareStore.getState().files, patient, referral, extras).length > 0;
    if (!alreadyHave) setLoading(true);
    setLoadError(null);
    fetchFilesForChart(patient, referral)
      .then((records) => {
        const mapped = {};
        for (const r of records) {
          const f = normalizeFileRecord(r);
          if (f?._id) mapped[f._id] = f;
        }
        if (Object.keys(mapped).length) mergeEntities('files', mapped);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message || 'Could not load files');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [patient?.id, patient?._id, referral?.id, referral?._id]);

  const activeFiles = useMemo(() => files.filter((f) => !f.archived_at), [files]);
  const archivedFiles = useMemo(
    () => files.filter((f) => f.archived_at)
      .sort((a, b) => (b.archived_at || '').localeCompare(a.archived_at || '')),
    [files],
  );

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
      const { r2Key, r2Url } = await uploadToR2(pendingFile, patient);

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
          ? { document_date: toCalendarDateInput(pendingDocumentDate) }
          : {}),
        ...(isOpwddCategory(pendingCategory) && pendingDocumentValidThrough
          ? { document_valid_through: toCalendarDateInput(pendingDocumentValidThrough) }
          : {}),
      };

      const created = await createFile({
        ...baseFields,
        ...(pendingPhysician?.id ? { physician_id: pendingPhysician.id } : {}),
      });

      const uploaded = { _id: created.id, ...created.fields, _justUploaded: true };
      mergeEntities('files', { [created.id]: uploaded });

      if (pendingCategory === 'F2F' && referral) {
        notifyPostSocF2fUploaded({
          referral,
          patient,
          actorUserId: appUserId,
          actorName: appUserName,
          uploadedOn: todayCalendarDate(),
        }).catch(() => {});
      }

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

      // If category is F2F, the visit date drives the 90-day expiration clock.
      // Store calendar dates (YYYY-MM-DD) only — ISO midnight-UTC shifts display
      // back one day in US Eastern.
      if (pendingCategory === 'F2F' && f2fDate && referral?._id) {
        const visitDate = toCalendarDateInput(f2fDate);
        const f2fFields = {
          f2f_date: visitDate,
          f2f_expiration: addCalendarDays(visitDate, 90),
          f2f_date_logged_by_id: appUserId || 'unknown',
          f2f_date_logged_at: new Date().toISOString(),
        };
        try {
          await updateReferralOptimistic(referral._id, f2fFields);
          await maybeClearDocumentationDeferred(
            { ...referral, ...f2fFields },
            { actorUserId: appUserId, source: 'files_tab_f2f' },
          );
        } catch {
          await updateReferral(referral._id, f2fFields).catch(() => {});
        }
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
    <div style={{ padding: isMobile ? '14px 14px 28px' : '20px' }}>
      {/* Drop zone — only shown when no pending file */}
      {!readOnly && can(PERMISSION_KEYS.FILE_UPLOAD) && !pendingFile && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); stageFile(e.dataTransfer.files); }}
          onClick={() => r2Configured && inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.15)}`,
            borderRadius: 12,
            padding: isMobile ? '22px 16px' : '20px 16px',
            textAlign: 'center',
            marginBottom: 16,
            background: dragOver ? hexToRgba(palette.primaryMagenta.hex, 0.04) : hexToRgba(palette.backgroundDark.hex, 0.02),
            transition: 'all 0.15s',
            cursor: r2Configured ? 'pointer' : 'default',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <input ref={inputRef} type="file" style={{ display: 'none' }} onChange={(e) => stageFile(e.target.files)} />
          {r2Configured ? (
            <>
              <p style={{ fontSize: isMobile ? 15 : 13, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 4 }}>
                {isMobile ? 'Tap to upload a file' : 'Drop file here or click to upload'}
              </p>
              <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
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
                      setF2fDate(toCalendarDateInput(referral.f2f_date));
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
                          const d = parseCalendarDate(pendingDocumentDate);
                          if (d) {
                            d.setFullYear(d.getFullYear() + tmpl.validityYears);
                            setPendingDocumentValidThrough(toCalendarDateString(d));
                          }
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
                        const d = parseCalendarDate(e.target.value);
                        if (d) {
                          d.setFullYear(d.getFullYear() + tmpl.validityYears);
                          setPendingDocumentValidThrough(toCalendarDateString(d));
                        }
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
                      Expires {fmtCalendarDate(addCalendarDays(f2fDate, 90), '')}
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
                      Expires {fmtCalendarDate(addCalendarDays(f2fDate, 90), '')}
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

          {/* Source provider — independent of the patient's PCP / referral physician */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              <p style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0,
              }}>
                Provider this file came from
              </p>
              <span style={{ fontSize: 11, fontWeight: 550, color: hexToRgba(palette.backgroundDark.hex, 0.38) }}>
                Optional
              </span>
            </div>
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.48), marginBottom: 8, lineHeight: 1.4 }}>
              Who authored or sent this document — not the patient’s PCP. Leave blank if unknown.
            </p>
            <PhysicianPicker
              physicianId={pendingPhysician?.id || null}
              onChange={setPendingPhysician}
              compact
            />
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

      {loadError && files.length > 0 && (
        <p style={{ textAlign: 'center', fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), padding: '0 0 10px', margin: 0 }}>
          Couldn’t refresh files from the server. Showing what’s already on this chart.
        </p>
      )}

      {loading && files.length === 0 ? (
        <LoadingState message="Loading files..." size="small" />
      ) : files.length === 0 ? (
        <p style={{ textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), padding: '24px 0', fontStyle: 'italic' }}>
          {loadError ? `Couldn’t load files. ${loadError}` : 'No files uploaded yet.'}
        </p>
      ) : (
        <>
          {activeFiles.length === 0 ? (
            <p style={{ textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), padding: '24px 0', fontStyle: 'italic' }}>
              No active files — all files are archived below.
            </p>
          ) : (
            <GroupedFileList
              files={activeFiles}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              search={search}
              setSearch={setSearch}
              collapsedGroups={collapsedGroups}
              toggleGroup={(id) => setCollapsedGroups((prev) => ({ ...prev, [id]: !prev[id] }))}
              onPreview={setPreview}
              onOpenToSide={isMobile ? undefined : (file) => openFileBeside(file, patient, referral)}
              onDelete={readOnly ? undefined : handleDeleteFile}
              onArchive={readOnly ? undefined : handleArchiveFile}
              resolveUser={resolveUser}
              resolvePhysician={resolvePhysician}
              appUserName={appUserName}
            />
          )}

          {archivedFiles.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <button
                onClick={() => setArchivedOpen((v) => !v)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  background: hexToRgba(palette.backgroundDark.hex, 0.04),
                  border: `1px dashed ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
                  borderRadius: 7, fontSize: 11.5, fontWeight: 700,
                  color: hexToRgba(palette.backgroundDark.hex, 0.5),
                  textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 11, opacity: 0.7 }}>{archivedOpen ? '▾' : '▸'}</span>
                <span style={{ flex: 1, textAlign: 'left' }}>Archived</span>
                <span style={{ fontSize: 10.5, opacity: 0.7 }}>{archivedFiles.length}</span>
              </button>
              {archivedOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 5 }}>
                  <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.42), padding: '0 2px', lineHeight: 1.45 }}>
                    Archived files are kept — not deleted. They are left out of EMR packet downloads unless explicitly included.
                  </p>
                  {archivedFiles.map((file) => (
                    <FileRow key={file._id} file={file}
                      onPreview={setPreview}
                      onOpenToSide={isMobile ? undefined : (f) => openFileBeside(f, patient, referral)}
                      onDelete={readOnly ? undefined : handleDeleteFile}
                      onRestore={readOnly ? undefined : handleRestoreFile}
                      resolveUser={resolveUser} resolvePhysician={resolvePhysician}
                      appUserName={appUserName} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {preview && (
        <FilePreviewModal
          file={preview}
          onClose={() => setPreview(null)}
          onOpenToSide={isMobile ? undefined : () => openFileBeside(preview, patient, referral)}
        />
      )}
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
  onPreview, onOpenToSide, onDelete, onArchive, resolveUser, resolvePhysician, appUserName,
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
      match: (file) => ['Insurance', 'Facesheet', 'ID', 'Consent'].includes(file.category),
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
      id: 'records',
      label: 'Clinical Records',
      match: (file) => file.category === 'Medications' || file.category === 'Progress Notes',
      accent: palette.accentGreen.hex,
    },
    {
      id: 'other',
      // Catch-all: anything not claimed by a group above (incl. Other,
      // Miscellaneous, empty, or any unrecognised category) so no file is
      // ever hidden from the list.
      label: 'Other / Uncategorized',
      match: (file) => {
        const c = file.category;
        if (!c) return true;
        if (isOpwddCategory(c)) return false;
        return !['F2F', 'MD Orders', 'Insurance', 'Facesheet', 'ID', 'Consent', 'Auth Letter', 'Discharge', 'Medications', 'Progress Notes'].includes(c);
      },
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
        const fromProvider = f.physician_id ? resolvePhysician?.(f.physician_id) : '';
        const hay = [f.file_name, f.category, f.document_subtype, fromProvider].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [files, categoryFilter, search, groupDefs, resolvePhysician]);

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
                            onPreview={onPreview} onOpenToSide={onOpenToSide} onDelete={onDelete}
                            onArchive={onArchive}
                            resolveUser={resolveUser} resolvePhysician={resolvePhysician}
                            appUserName={appUserName} />
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  group.items.map((file) => (
                    <FileRow key={file._id} file={file}
                      onPreview={onPreview} onOpenToSide={onOpenToSide} onDelete={onDelete}
                      onArchive={onArchive}
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

// ── File row buttons — flat, solid colors, one clear primary ────────────────
// No borders, no translucent tints. "Open to side" is the workhorse action,
// so it gets the solid magenta; utilities are quiet solid-gray; destructive/
// housekeeping actions are plain text.
const FILE_BTN_BASE = {
  padding: '6px 13px', borderRadius: 7, border: 'none', cursor: 'pointer',
  fontSize: 12, fontWeight: 650, fontFamily: 'inherit', lineHeight: 1.2,
  whiteSpace: 'nowrap',
};
const FILE_BTN = {
  primary: { ...FILE_BTN_BASE, background: palette.primaryMagenta.hex, color: '#FFFFFF' },
  neutral: { ...FILE_BTN_BASE, background: '#EFEEF3', color: '#4B4554' },
  ghost:   { ...FILE_BTN_BASE, background: 'transparent', color: '#8A8494', fontWeight: 600 },
  danger:  { ...FILE_BTN_BASE, background: 'transparent', color: palette.primaryMagenta.hex, fontWeight: 600 },
  success: { ...FILE_BTN_BASE, background: palette.accentGreen.hex, color: '#FFFFFF' },
};

function FileRow({ file, onPreview, onOpenToSide, onDelete, onArchive, onRestore, resolveUser, resolvePhysician, appUserName }) {
  const kind = getFileIcon(file.file_type, file.file_name);
  const catColors = CATEGORY_COLORS[file.category] || CATEGORY_COLORS['Other'];
  // Private R2: a file is viewable/downloadable as long as we have its key
  // (we mint a short-lived signed URL on demand).
  const canPreview = !!(file.r2_key && String(file.r2_key).trim());
  const opwddSubtypeLabel = file.document_subtype
    ? OPWDD_CHECKLIST_BY_KEY[file.document_subtype]?.label || file.document_subtype
    : null;
  const validThroughDays = file.document_valid_through ? daysUntilCalendarDate(file.document_valid_through) : null;
  const isExpired = validThroughDays != null && validThroughDays < 0;
  const isArchived = !!file.archived_at;
  const rowBg = isArchived ? '#F4F4F6' : palette.backgroundLight.hex;

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 8,
        border: `1px solid var(--color-border)`,
        background: rowBg,
        opacity: isArchived ? 0.85 : 1,
      }}
    >
      {/* Name + meta — full width so long file names never squeeze vertical */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <FileIconSVG kind={kind} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex, wordBreak: 'break-word', lineHeight: 1.35, margin: 0 }}>
            {file.file_name || 'Unnamed'}
          </p>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            {isArchived && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: '#E2E1E7', color: '#6C667A', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Archived
              </span>
            )}
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
            {file.document_valid_through && (
              <span style={{ fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: isExpired ? hexToRgba(palette.primaryMagenta.hex, 0.08) : hexToRgba(palette.accentGreen.hex, 0.12), color: isExpired ? palette.primaryMagenta.hex : '#15803d' }}>
                {isExpired ? 'Expired ' : 'Valid through '}{fmtCalendarDate(file.document_valid_through, '')}
              </span>
            )}
            <FileSourceProviderBadge file={file} resolvePhysician={resolvePhysician} size="sm" />
          </div>
          <p style={{ fontSize: 11, color: '#9B96A6', marginTop: 4, marginBottom: 0 }}>
            {file.file_size ? `${formatBytes(file.file_size)} · ` : ''}
            Uploaded {formatDateTime(file.created_at)}
            {file.uploaded_by_id ? ` · ${resolveUser(file.uploaded_by_id)}` : file._justUploaded ? ` · ${appUserName}` : ''}
          </p>
          {isArchived && (
            <p style={{ fontSize: 11, color: '#7C7689', marginTop: 2, marginBottom: 0 }}>
              Archived {formatDateTime(file.archived_at)}
              {file.archived_by_id ? ` · ${resolveUser(file.archived_by_id)}` : ''}
              {file.archived_reason ? ` — ${file.archived_reason}` : ''}
            </p>
          )}
        </div>
      </div>

      {/* Actions — one primary, quiet utilities, text-only housekeeping */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {canPreview && onOpenToSide && (
          <button type="button" onClick={() => onOpenToSide(file)} title="Open beside patient snapshot" style={FILE_BTN.primary}>
            Open to side
          </button>
        )}
        {canPreview && (
          <button
            type="button"
            onClick={() => onPreview(file)}
            style={onOpenToSide ? FILE_BTN.neutral : FILE_BTN.primary}
          >
            Preview
          </button>
        )}
        {canPreview && (
          <button type="button" onClick={() => openSignedFile(file, { download: true })} style={FILE_BTN.neutral}>
            Download
          </button>
        )}
        {onRestore && isArchived && (
          <button type="button" onClick={() => onRestore(file)} title="Restore file to the active list" style={FILE_BTN.success}>
            Restore
          </button>
        )}
        <span style={{ flex: 1 }} />
        {onArchive && !isArchived && (
          <button
            type="button"
            onClick={() => onArchive(file)}
            title="Archive file — kept and restorable, excluded from packet downloads"
            style={FILE_BTN.ghost}
          >
            Archive
          </button>
        )}
        {onDelete && (
          <button type="button" onClick={() => onDelete(file)} title="Delete file" style={FILE_BTN.danger}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
