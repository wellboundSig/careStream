/**
 * HospitalizationReview — the "recent hospitalization" question inside the
 * cursory review. Shared by the Intake panel, the F2F module panel, and the
 * drawer F2F tab so the three surfaces stay identical.
 *
 * Behaviour:
 *  - A checkbox: "Recent hospitalization within the last 14 days?"
 *  - If yes: a date picker (the hospitalization date) + a discharge-paper
 *    upload appears. The uploaded file is synced to the Files table with
 *    category "Discharge".
 *  - If no: the date is cleared and the upload control hides.
 *
 * Persistence: `recent_hospitalization` + `hospitalization_date` are written
 * to the Referral (optimistically) so the Patient Snapshot can render the
 * hospital indicator immediately. Discharge files go to the Files table.
 */

import { useState, useEffect, useRef } from 'react';
import { updateReferralOptimistic } from '../../../store/mutations.js';
import { triggerDataRefresh } from '../../../hooks/useRefreshTrigger.js';
import { getFilesByPatient, createFile } from '../../../api/patientFiles.js';
import { uploadToR2, fileToUrl } from '../../../utils/r2Upload.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import palette, { hexToRgba } from '../../../utils/colors.js';

function isTrue(v) { return v === true || v === 'true'; }

export default function HospitalizationReview({ referral, patient, readOnly = false }) {
  const { appUserId } = useCurrentAppUser();
  const recordId = referral?._id;
  const patientBusinessId = patient?.id || referral?.patient_id;

  const [recent, setRecent] = useState(isTrue(referral?.recent_hospitalization));
  const [hospDate, setHospDate] = useState(referral?.hospitalization_date || '');
  const [dischargeFiles, setDischargeFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  // Re-seed when the selected referral changes.
  useEffect(() => {
    setRecent(isTrue(referral?.recent_hospitalization));
    setHospDate(referral?.hospitalization_date || '');
    setUploadError(null);
  }, [referral?._id, referral?.recent_hospitalization, referral?.hospitalization_date]);

  // Load existing discharge papers for this patient so the reviewer can see
  // what's already attached.
  useEffect(() => {
    if (!patientBusinessId) { setDischargeFiles([]); return; }
    let cancelled = false;
    getFilesByPatient(patientBusinessId)
      .then((recs) => {
        if (cancelled) return;
        const mapped = recs.map((r) => ({ _id: r.id, ...r.fields }));
        setDischargeFiles(mapped.filter((f) => f.category === 'Discharge'));
      })
      .catch(() => { if (!cancelled) setDischargeFiles([]); });
    return () => { cancelled = true; };
  }, [patientBusinessId]);

  const today = new Date().toISOString().split('T')[0];

  function persist(fields) {
    if (!recordId) return;
    updateReferralOptimistic(recordId, fields).catch(() => {});
    triggerDataRefresh();
  }

  function handleToggle() {
    if (readOnly) return;
    const next = !recent;
    setRecent(next);
    if (next) {
      persist({ recent_hospitalization: true });
    } else {
      // Clearing the flag also clears the date — the upload stays in Files as
      // an audit record but the referral no longer flags a recent hospitalization.
      setHospDate('');
      persist({ recent_hospitalization: false, hospitalization_date: '' });
    }
  }

  function handleDateChange(val) {
    if (readOnly) return;
    setHospDate(val);
    persist({ hospitalization_date: val, recent_hospitalization: true });
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !patientBusinessId || readOnly) return;
    setUploading(true); setUploadError(null);
    try {
      const { r2Key, r2Url } = await uploadToR2(file, patientBusinessId);
      const created = await createFile({
        id: `file_${Date.now()}`,
        patient_id: patientBusinessId,
        referral_id: referral?.id || null,
        uploaded_by_id: appUserId || 'unknown',
        file_name: file.name,
        file_type: file.type || 'application/octet-stream',
        file_size: file.size,
        r2_key: r2Key,
        r2_url: r2Url,
        category: 'Discharge',
        created_at: new Date().toISOString(),
      });
      setDischargeFiles((prev) => [{ _id: created.id, ...created.fields }, ...prev]);
      triggerDataRefresh();
    } catch (err) {
      setUploadError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.08)}` }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: readOnly ? 'default' : 'pointer' }}>
        <input
          type="checkbox"
          checked={recent}
          disabled={readOnly}
          onChange={handleToggle}
          style={{ accentColor: palette.primaryMagenta.hex, width: 13, height: 13, flexShrink: 0, marginTop: 1 }}
        />
        <span style={{ fontSize: 12, fontWeight: 600, color: palette.backgroundDark.hex, lineHeight: 1.4 }}>
          Recent hospitalization within the last 14 days?
        </span>
      </label>

      {recent && (
        <div style={{ marginTop: 8, paddingLeft: 21 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 4 }}>Date of hospitalization</p>
          <input
            type="date"
            value={hospDate}
            max={today}
            disabled={readOnly}
            onChange={(e) => handleDateChange(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6, border: `1px solid ${hospDate ? palette.primaryMagenta.hex : 'var(--color-border)'}`, fontSize: 12.5, fontFamily: 'inherit', outline: 'none', background: palette.backgroundLight.hex, color: palette.backgroundDark.hex, marginBottom: 8 }}
          />

          <p style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 4 }}>Discharge papers</p>
          {dischargeFiles.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
              {dischargeFiles.map((f) => {
                const url = fileToUrl(f);
                return (
                  <div key={f._id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                    <span style={{ color: palette.accentGreen.hex, flexShrink: 0 }}>✓</span>
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: palette.accentBlue.hex, textDecoration: 'none', wordBreak: 'break-word' }}>{f.file_name || 'Discharge document'}</a>
                    ) : (
                      <span style={{ color: palette.backgroundDark.hex, wordBreak: 'break-word' }}>{f.file_name || 'Discharge document'}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {!readOnly && (
            <>
              <input ref={fileInputRef} type="file" onChange={handleUpload} style={{ display: 'none' }} id={`discharge-upload-${recordId}`} />
              <label
                htmlFor={`discharge-upload-${recordId}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 6, cursor: uploading ? 'wait' : 'pointer', fontSize: 11.5, fontWeight: 650, background: hexToRgba(palette.highlightYellow.hex, 0.15), color: '#7A5F00', border: `1px solid ${hexToRgba(palette.highlightYellow.hex, 0.35)}` }}
              >
                {uploading ? 'Uploading…' : '↑ Upload discharge papers'}
              </label>
            </>
          )}
          {uploadError && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 6 }}>{uploadError}</p>}
        </div>
      )}
    </div>
  );
}
