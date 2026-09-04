import { useRef, useState } from 'react';
import PhysicianPicker from '../physicians/PhysicianPicker.jsx';
import { createFile } from '../../api/patientFiles.js';
import { updateReferral } from '../../api/referrals.js';
import { mergeEntities } from '../../store/careStore.js';
import { uploadToR2 } from '../../utils/r2Upload.js';
import { addCalendarDays, toCalendarDateInput } from '../../utils/dateFormat.js';
import { OPWDD_FILE_CATEGORIES } from '../../data/opwddEnums.js';
import palette, { hexToRgba } from '../../utils/colors.js';

export const LEAD_FILE_CATEGORIES = [
  'F2F', 'MD Orders', 'Auth Letter', 'Insurance', 'Facesheet', 'Discharge', 'ID', 'Consent',
  'Medications', 'Progress Notes', 'Miscellaneous', 'Other',
  ...OPWDD_FILE_CATEGORIES,
];

function newStagedId() {
  return `staged_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function fileSizeLabel(size) {
  if (!size) return '';
  return size < 1048576
    ? `${(size / 1024).toFixed(1)} KB`
    : `${(size / 1048576).toFixed(1)} MB`;
}

export function stageFilesFromList(fileList, existing = []) {
  if (!fileList?.length) return existing;
  const added = Array.from(fileList).map((file) => ({
    id: newStagedId(),
    file,
    category: 'Other',
    physician: null,
    f2fDate: '',
  }));
  return [...existing, ...added];
}

/**
 * Upload files staged on the new-referral form after patient + referral exist.
 * Failures are collected — the referral itself is already saved.
 */
export async function uploadStagedLeadFiles({
  stagedFiles,
  patientId,
  referralId,
  referralRecId,
  appUserId,
}) {
  const failures = [];
  let latestF2fDate = '';

  for (const item of stagedFiles || []) {
    if (!item?.file) continue;
    try {
      const { r2Key, r2Url } = await uploadToR2(item.file, patientId);
      const visitDate = item.category === 'F2F' && item.f2fDate
        ? toCalendarDateInput(item.f2fDate)
        : '';
      const created = await createFile({
        id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        patient_id: patientId,
        referral_id: referralId,
        uploaded_by_id: appUserId || 'unknown',
        file_name: item.file.name,
        file_size: item.file.size,
        r2_key: r2Key,
        r2_url: r2Url,
        category: item.category || 'Other',
        created_at: new Date().toISOString(),
        ...(visitDate ? { f2f_visit_date: visitDate } : {}),
        ...(item.physician?.id ? { physician_id: item.physician.id } : {}),
      });
      if (created?.id) {
        mergeEntities('files', { [created.id]: { _id: created.id, ...created.fields } });
      }
      if (visitDate && (!latestF2fDate || visitDate > latestF2fDate)) {
        latestF2fDate = visitDate;
      }
    } catch (err) {
      failures.push({ name: item.file.name, message: err?.message || 'Upload failed' });
    }
  }

  if (latestF2fDate && referralRecId) {
    await updateReferral(referralRecId, {
      f2f_date: latestF2fDate,
      f2f_expiration: addCalendarDays(latestF2fDate, 90),
      f2f_date_logged_by_id: appUserId || 'unknown',
      f2f_date_logged_at: new Date().toISOString(),
    }).catch(() => {});
  }

  return failures;
}

export function stagedFilesNeedF2fDate(stagedFiles) {
  return (stagedFiles || []).some((f) => f.category === 'F2F' && !f.f2fDate);
}

export default function LeadFileAttachments({ files, onChange }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  function addFiles(fileList) {
    onChange(stageFilesFromList(fileList, files));
    if (inputRef.current) inputRef.current.value = '';
  }

  function patch(id, next) {
    onChange(files.map((f) => (f.id === id ? { ...f, ...next } : f)));
  }

  function remove(id) {
    onChange(files.filter((f) => f.id !== id));
  }

  return (
    <div>
      <p style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: hexToRgba(palette.backgroundDark.hex, 0.38), margin: '20px 0 10px',
      }}>
        Files
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.15)}`,
          borderRadius: 10,
          padding: '14px 12px',
          textAlign: 'center',
          background: dragOver ? hexToRgba(palette.primaryMagenta.hex, 0.04) : hexToRgba(palette.backgroundDark.hex, 0.02),
          cursor: 'pointer',
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => addFiles(e.target.files)}
        />
        <p style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex, margin: 0 }}>
          Drop files or click to add
        </p>
      </div>

      {files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
          {files.map((item) => (
            <div
              key={item.id}
              style={{
                border: `1px solid var(--color-border)`,
                borderRadius: 10,
                padding: '12px 14px',
                background: hexToRgba(palette.backgroundDark.hex, 0.02),
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{
                  fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex,
                  flex: 1, minWidth: 0, wordBreak: 'break-all',
                }}>
                  {item.file.name}
                </span>
                <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), flexShrink: 0 }}>
                  {fileSizeLabel(item.file.size)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                    color: hexToRgba(palette.backgroundDark.hex, 0.4), fontSize: 16, lineHeight: 1,
                  }}
                  aria-label={`Remove ${item.file.name}`}
                >
                  ×
                </button>
              </div>

              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: item.category === 'F2F' ? 10 : 12 }}>
                {LEAD_FILE_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => patch(item.id, { category: cat, ...(cat !== 'F2F' ? { f2fDate: '' } : {}) })}
                    style={{
                      padding: '3px 9px', borderRadius: 6, border: '1px solid var(--color-border)',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: item.category === cat
                        ? (OPWDD_FILE_CATEGORIES.includes(cat) ? palette.primaryDeepPlum.hex : palette.primaryMagenta.hex)
                        : 'none',
                      color: item.category === cat
                        ? palette.backgroundLight.hex
                        : hexToRgba(palette.backgroundDark.hex, 0.6),
                    }}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {item.category === 'F2F' && (
                <div style={{ marginBottom: 12 }}>
                  <input
                    type="date"
                    value={item.f2fDate}
                    onChange={(e) => patch(item.id, { f2fDate: e.target.value })}
                    aria-label={`Visit date for ${item.file.name}`}
                    style={{
                      width: '100%', padding: '7px 10px', borderRadius: 6, boxSizing: 'border-box',
                      border: `1px solid ${item.f2fDate ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.15)}`,
                      fontSize: 13, fontFamily: 'inherit', background: palette.backgroundLight.hex,
                    }}
                  />
                </div>
              )}

              <p style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: hexToRgba(palette.backgroundDark.hex, 0.38), margin: '0 0 6px',
              }}>
                Provider
              </p>
              <PhysicianPicker
                physicianId={item.physician?.id || null}
                onChange={(physician) => patch(item.id, { physician })}
                compact
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
