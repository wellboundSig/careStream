import { useState, useEffect, useRef } from 'react';
import { useUser } from '@clerk/react';
import { getFilesByPatient, createFile } from '../../../api/patientFiles.js';
import { uploadToR2 } from '../../../utils/r2Upload.js';
import { updateReferral } from '../../../api/referrals.js';
import { triggerDataRefresh } from '../../../hooks/useRefreshTrigger.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { useLookups } from '../../../hooks/useLookups.js';
import PhysicianPicker from '../../physicians/PhysicianPicker.jsx';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

const CATEGORY_COLORS = {
  'F2F': { bg: hexToRgba(palette.primaryMagenta.hex, 0.1), text: palette.primaryMagenta.hex },
  'MD Orders': { bg: hexToRgba(palette.accentOrange.hex, 0.12), text: '#8B4A00' },
  'Auth Letter': { bg: hexToRgba(palette.accentGreen.hex, 0.1), text: '#3A6E00' },
  'Insurance': { bg: hexToRgba(palette.accentBlue.hex, 0.1), text: '#005B84' },
  'Discharge': { bg: hexToRgba(palette.highlightYellow.hex, 0.15), text: '#7A5F00' },
  'ID': { bg: hexToRgba(palette.backgroundDark.hex, 0.07), text: hexToRgba(palette.backgroundDark.hex, 0.6) },
  'Consent': { bg: hexToRgba(palette.backgroundDark.hex, 0.07), text: hexToRgba(palette.backgroundDark.hex, 0.6) },
  'Other': { bg: hexToRgba(palette.backgroundDark.hex, 0.06), text: hexToRgba(palette.backgroundDark.hex, 0.5) },
};

const FILE_CATEGORIES = ['F2F', 'MD Orders', 'Auth Letter', 'Insurance', 'Discharge', 'ID', 'Consent', 'Other'];

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
          ) : kind === 'pdf' ? (
            <iframe src={url} title={file.file_name} style={{ width: '100%', height: '60vh', border: 'none', borderRadius: 8 }} />
          ) : (
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 12 }}>No inline preview for this file type.</p>
              <a href={url} target="_blank" rel="noopener noreferrer" style={{ padding: '8px 20px', borderRadius: 8, background: palette.primaryMagenta.hex, color: palette.backgroundLight.hex, fontSize: 13, fontWeight: 650, textDecoration: 'none' }}>
                Open in new tab
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function FilesTab({ patient, referral }) {
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
  const inputRef = useRef(null);

  const r2Configured = !!import.meta.env.VITE_R2_WORKER_URL;

  useEffect(() => {
    if (!patient?.id) return;
    setLoading(true);
    getFilesByPatient(patient.id)
      .then((records) => setFiles(records.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [patient?.id]);

  function stageFile(fileList) {
    if (!fileList?.length || uploading) return;
    setPendingFile(fileList[0]);
    setPendingCategory('Other');
    setPendingPhysician(null);
    setF2fDate('');
    setF2fDatePrefilled(false);
    setUploadError(null);
  }

  function cancelStaging() {
    setPendingFile(null);
    setPendingPhysician(null);
    setF2fDate('');
    setF2fDatePrefilled(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function confirmUpload() {
    if (!pendingFile || uploading) return;
    setUploading(true);
    setUploadError(null);
    setUploadProgress(`Uploading ${pendingFile.name}…`);

    try {
      const { r2Key, r2Url } = await uploadToR2(pendingFile, patient.id);

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

      // If category is F2F and a received date was entered, start the 90-day expiration clock
      if (pendingCategory === 'F2F' && f2fDate && referral?._id) {
        const received = new Date(f2fDate);
        const expiration = new Date(received);
        expiration.setDate(expiration.getDate() + 90);
        await updateReferral(referral._id, {
          f2f_date: received.toISOString(),
          f2f_expiration: expiration.toISOString(),
        }).catch(() => {});
        triggerDataRefresh();
      }

      setPendingFile(null);
      setPendingPhysician(null);
      setF2fDate('');
      setF2fDatePrefilled(false);
      setUploadProgress(null);
      if (inputRef.current) inputRef.current.value = '';
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
      {!pendingFile && (
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
      {pendingFile && !uploading && (
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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
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
                }}
                style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid var(--color-border)`, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', transition: 'all 0.12s', background: pendingCategory === cat ? palette.primaryMagenta.hex : 'none', color: pendingCategory === cat ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6) }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* F2F received date — only shown when F2F category is selected */}
          {pendingCategory === 'F2F' && (
            <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8, background: hexToRgba(palette.primaryMagenta.hex, 0.05), border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.2)}` }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: palette.primaryMagenta.hex, marginBottom: 4 }}>F2F Received Date</p>

              {f2fDatePrefilled ? (
                /* Existing date — just confirm it */
                <div>
                  <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 8 }}>
                    This referral already has an F2F date on record. Confirm or adjust below.
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
                /* No existing date — pick one */
                <div>
                  <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 8 }}>
                    Sets the 90-day F2F expiration clock on this referral.
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
                    <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35), marginTop: 4 }}>
                      Optional — leave blank to skip
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
            <button
              onClick={confirmUpload}
              style={{ padding: '8px 20px', borderRadius: 7, background: palette.primaryDeepPlum.hex, border: 'none', fontSize: 13, fontWeight: 650, color: '#fff', cursor: 'pointer' }}
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
      {uploading && uploadProgress && (
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {files.map((file) => (
            <FileRow key={file._id} file={file} onPreview={setPreview} resolveUser={resolveUser} resolvePhysician={resolvePhysician} appUserName={appUserName} />
          ))}
        </div>
      )}

      {preview && <PreviewModal file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function FileRow({ file, onPreview, resolveUser, resolvePhysician, appUserName }) {
  const kind = getFileIcon(file.file_type, file.file_name);
  const catColors = CATEGORY_COLORS[file.category] || CATEGORY_COLORS['Other'];
  const cleanUrl = file.r2_url?.replace(/[<>\n]/g, '').trim();
  const canPreview = !!cleanUrl;
  const physicianName = file.physician_id ? resolvePhysician?.(file.physician_id) : null;

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
        borderRadius: 9, border: `1px solid var(--color-border)`,
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
      </div>
    </div>
  );
}
