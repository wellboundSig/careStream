import { useState, useEffect, useRef } from 'react';
import { getFilesByPatient, createFile } from '../../../api/patientFiles.js';
import { uploadToR2 } from '../../../utils/r2Upload.js';
import { updateReferral } from '../../../api/referrals.js';
import { triggerDataRefresh } from '../../../hooks/useRefreshTrigger.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { useLookups } from '../../../hooks/useLookups.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';
import { F2F_REVIEW_CHECKLIST, F2F_REQUIRED_ITEMS, isF2FChecklistComplete } from '../../../data/f2fChecklist.js';
import { useCursoryReview } from '../../../hooks/useCursoryReview.js';
import palette, { hexToRgba } from '../../../utils/colors.js';

function daysLeft(exp) {
  if (!exp) return null;
  return Math.ceil((new Date(exp) - Date.now()) / 86400000);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 12, paddingBottom: 6, borderBottom: `1px solid var(--color-border)` }}>{title}</p>
      {children}
    </div>
  );
}

function InfoRow({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0' }}>
      <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: color || palette.backgroundDark.hex }}>{value}</span>
    </div>
  );
}

export default function F2FTab({ patient, referral, readOnly = false }) {
  const { can } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const { resolvePhysician } = useLookups();

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [receivedDate, setReceivedDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Cursory review checklist — persisted to the CursoryReview table.
  const {
    checked: reviewChecked,
    toggle: toggleReview,
    saving: reviewSaving,
    saveError: reviewSaveError,
  } = useCursoryReview(referral?._id);

  const [files, setFiles] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadCategory, setUploadCategory] = useState('F2F');
  const fileInputRef = useRef(null);

  useEffect(() => {
    setShowDatePicker(false);
    setReceivedDate('');
    setSaveError(null);
  }, [referral?._id]);

  useEffect(() => {
    if (!patient?.id) return;
    setLoadingFiles(true);
    getFilesByPatient(patient.id)
      .then((recs) => {
        const mapped = recs.map((r) => ({ _id: r.id, ...r.fields }));
        setFiles(mapped.filter((f) => f.category === 'F2F' || f.category === 'MD Orders'));
      })
      .catch(() => {})
      .finally(() => setLoadingFiles(false));
  }, [patient?.id]);

  const days = referral ? daysLeft(referral.f2f_expiration) : null;
  const urgencyColor = days === null ? null
    : days < 0 ? palette.primaryMagenta.hex
    : days <= 7 ? palette.primaryMagenta.hex
    : days <= 14 ? palette.accentOrange.hex
    : days <= 30 ? '#7A5F00'
    : palette.accentGreen.hex;

  async function handleLogReceived() {
    if (!receivedDate || !referral) return;
    setSaving(true);
    setSaveError(null);
    try {
      const expiration = addDays(receivedDate, 90);
      await updateReferral(referral._id, { f2f_date: receivedDate, f2f_expiration: expiration });
      triggerDataRefresh();
      setShowDatePicker(false);
      setReceivedDate('');
    } catch (err) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !patient) return;
    setUploading(true);
    try {
      const r2Result = await uploadToR2(file);
      const fields = {
        patient_id: patient.id,
        referral_id: referral?.id || null,
        uploaded_by_id: appUserId || 'unknown',
        file_name: file.name,
        file_type: file.type || 'application/octet-stream',
        file_size: file.size,
        r2_key: r2Result.key,
        r2_url: r2Result.url,
        category: uploadCategory,
        created_at: new Date().toISOString(),
      };
      const created = await createFile(fields);
      setFiles((prev) => [{ _id: created.id, ...created.fields }, ...prev]);

      if (uploadCategory === 'F2F' && referral && !referral.f2f_date) {
        const today = new Date().toISOString().split('T')[0];
        await updateReferral(referral._id, { f2f_date: today, f2f_expiration: addDays(today, 90) });
        triggerDataRefresh();
      }
    } catch { /* silent */ } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const reviewComplete = isF2FChecklistComplete(reviewChecked);
  const completedReq = F2F_REQUIRED_ITEMS.filter((i) => reviewChecked[i.key]).length;
  const totalReq = F2F_REQUIRED_ITEMS.length;

  if (!referral) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>No active referral selected.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 20px 40px' }}>
      {/* F2F Status */}
      <Section title="F2F Status">
        {days !== null ? (
          <div style={{ textAlign: 'center', padding: '12px 0 16px' }}>
            <p style={{ fontSize: 36, fontWeight: 800, color: urgencyColor, lineHeight: 1 }}>
              {days < 0 ? 'EXPIRED' : `${days}d`}
            </p>
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 4 }}>
              {days < 0 ? 'F2F has expired' : 'until F2F expiration'}
            </p>
            {referral.f2f_date && (
              <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35), marginTop: 3 }}>
                Visit {fmtDate(referral.f2f_date)} · Expires {fmtDate(referral.f2f_expiration)}
              </p>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), textAlign: 'center', padding: '12px 0' }}>
            No F2F date recorded
          </p>
        )}
        <InfoRow label="PECOS Verified" value={referral.is_pecos_verified === 'TRUE' || referral.is_pecos_verified === true ? 'Yes' : 'No'} color={referral.is_pecos_verified === 'TRUE' || referral.is_pecos_verified === true ? palette.accentGreen.hex : palette.primaryMagenta.hex} />
        <InfoRow label="OPRA Verified" value={referral.is_opra_verified === 'TRUE' || referral.is_opra_verified === true ? 'Yes' : 'No'} color={referral.is_opra_verified === 'TRUE' || referral.is_opra_verified === true ? palette.accentGreen.hex : undefined} />
        {referral.physician_id && (
          <InfoRow label="Physician" value={resolvePhysician(referral.physician_id)} />
        )}
      </Section>

      {/* Log F2F Date */}
      {!readOnly && can(PERMISSION_KEYS.CLINICAL_F2F) && (
        <Section title="Date of Visit">
          {!showDatePicker ? (
            <button
              onClick={() => {
                if (referral.f2f_date) setReceivedDate(new Date(referral.f2f_date).toISOString().split('T')[0]);
                setShowDatePicker(true);
              }}
              style={{
                width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
                background: referral.f2f_date ? hexToRgba(palette.accentGreen.hex, 0.1) : palette.accentGreen.hex,
                color: referral.f2f_date ? palette.accentGreen.hex : palette.backgroundLight.hex,
                fontSize: 13, fontWeight: 650, cursor: 'pointer',
              }}
            >
              {referral.f2f_date ? 'Update Date of Visit' : 'Log Date of Visit'}
            </button>
          ) : (
            <div style={{ borderRadius: 8, background: hexToRgba(palette.accentGreen.hex, 0.04), padding: '12px' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: palette.backgroundDark.hex, marginBottom: 8 }}>
                {referral.f2f_date ? 'Confirm or update date of visit' : 'When did the physician visit occur?'}
              </p>
              <input
                type="date"
                value={receivedDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setReceivedDate(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 7, border: `1px solid ${receivedDate ? palette.accentGreen.hex : 'var(--color-border)'}`, fontSize: 13, fontFamily: 'inherit', outline: 'none', background: palette.backgroundLight.hex, color: palette.backgroundDark.hex, marginBottom: 8 }}
              />
              {receivedDate && (
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 8 }}>
                  Expires <strong style={{ color: palette.accentOrange.hex }}>{fmtDate(addDays(receivedDate, 90))}</strong>
                </p>
              )}
              {saveError && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 8 }}>{saveError}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleLogReceived} disabled={!receivedDate || saving}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', background: receivedDate && !saving ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.08), color: receivedDate && !saving ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3), fontSize: 12, fontWeight: 650, cursor: receivedDate && !saving ? 'pointer' : 'not-allowed' }}
                >
                  {saving ? 'Saving...' : 'Confirm'}
                </button>
                <button
                  onClick={() => { setShowDatePicker(false); setReceivedDate(''); setSaveError(null); }} disabled={saving}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.08), color: hexToRgba(palette.backgroundDark.hex, 0.55), fontSize: 12, fontWeight: 650, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </Section>
      )}

      {/* File Upload */}
      <Section title="Documents">
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {['F2F', 'MD Orders'].map((cat) => (
            <button key={cat} onClick={() => setUploadCategory(cat)} style={{
              flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', fontSize: 11.5, fontWeight: 650, cursor: 'pointer',
              background: uploadCategory === cat ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.06),
              color: uploadCategory === cat ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
            }}>
              {cat}
            </button>
          ))}
        </div>
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleUpload} />
        {!readOnly && (
          <button
            onClick={() => fileInputRef.current?.click()} disabled={uploading}
            style={{ width: '100%', padding: '10px 0', borderRadius: 8, border: `1.5px dashed ${hexToRgba(palette.backgroundDark.hex, 0.15)}`, background: hexToRgba(palette.backgroundDark.hex, 0.02), color: hexToRgba(palette.backgroundDark.hex, 0.5), fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginBottom: 12 }}
          >
            {uploading ? 'Uploading...' : `Upload ${uploadCategory} Document`}
          </button>
        )}

        {loadingFiles ? (
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Loading files...</p>
        ) : files.length === 0 ? (
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No F2F or MD Order documents uploaded yet.</p>
        ) : (
          files.map((f) => (
            <div key={f._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={palette.primaryMagenta.hex} strokeWidth="1.6" /><path d="M14 2v6h6" stroke={palette.primaryMagenta.hex} strokeWidth="1.6" /></svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 12.5, fontWeight: 550, color: palette.backgroundDark.hex, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</p>
                <p style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{f.category} · {fmtDate(f.created_at)}</p>
              </div>
              {f.r2_url && (
                <a href={f.r2_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: palette.accentBlue.hex, textDecoration: 'none', fontWeight: 600, flexShrink: 0 }}>View</a>
              )}
            </div>
          ))
        )}
      </Section>

      {/* Document Review Checklist — persisted to CursoryReview table */}
      <Section title="Document Review">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            Cursory Review{reviewSaving ? ' · saving…' : ''}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: reviewComplete ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.4) }}>{completedReq}/{totalReq}</span>
        </div>
        <div style={{ height: 3, borderRadius: 2, background: hexToRgba(palette.backgroundDark.hex, 0.08), overflow: 'hidden', marginBottom: 10 }}>
          <div style={{ height: '100%', width: `${totalReq > 0 ? Math.round((completedReq / totalReq) * 100) : 0}%`, background: reviewComplete ? palette.accentGreen.hex : palette.accentOrange.hex, borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
        {reviewSaveError && (
          <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 6 }}>{reviewSaveError}</p>
        )}
        {F2F_REVIEW_CHECKLIST.map((item) => (
          <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: readOnly ? 'default' : 'pointer' }}>
            <input type="checkbox" checked={!!reviewChecked[item.key]} disabled={readOnly} onChange={() => { if (!readOnly) toggleReview(item.key); }} style={{ accentColor: palette.accentGreen.hex, width: 14, height: 14, flexShrink: 0, cursor: readOnly ? 'default' : 'pointer' }} />
            <span style={{ fontSize: 12.5, color: reviewChecked[item.key] ? hexToRgba(palette.backgroundDark.hex, 0.4) : palette.backgroundDark.hex, textDecoration: reviewChecked[item.key] ? 'line-through' : 'none', fontWeight: item.required ? 550 : 400 }}>
              {item.label}{item.required && !reviewChecked[item.key] ? ' *' : ''}
            </span>
          </label>
        ))}
      </Section>
    </div>
  );
}
