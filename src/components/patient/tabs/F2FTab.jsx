import { useState, useEffect, useRef, useMemo } from 'react';
import { getFilesByPatient, createFile } from '../../../api/patientFiles.js';
import { uploadToR2, openSignedFile } from '../../../utils/r2Upload.js';
import { updateReferralOptimistic } from '../../../store/mutations.js';
import { mergeEntities, useCareStore } from '../../../store/careStore.js';
import { triggerDataRefresh } from '../../../hooks/useRefreshTrigger.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { useLookups } from '../../../hooks/useLookups.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';
import { F2F_REVIEW_CHECKLIST, F2F_REQUIRED_ITEMS, isF2FChecklistComplete } from '../../../data/f2fChecklist.js';
import { useCursoryReview } from '../../../hooks/useCursoryReview.js';
import HospitalizationReview from '../../modules/shared/HospitalizationReview.jsx';
import FilePreviewModal from '../../common/FilePreviewModal.jsx';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import { formatPhysicianName } from '../../../utils/physicianName.js';
import palette, { hexToRgba } from '../../../utils/colors.js';
import {
  fmtCalendarDate,
  fmtDateTime,
  toCalendarDateInput,
  addCalendarDays,
  daysUntilCalendarDate,
} from '../../../utils/dateFormat.js';

function truthyFlag(v) {
  return v === true || v === 'true' || v === 'TRUE' || v === 'Yes' || v === 'yes' || v === 1 || v === '1';
}

function daysLeft(exp) {
  return daysUntilCalendarDate(exp);
}

function fmtDate(d) {
  return fmtCalendarDate(d, '');
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
  const { resolveUser } = useLookups();
  const { openFileBeside } = usePatientDrawer();
  const storePhysicians = useCareStore((s) => s.physicians);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [receivedDate, setReceivedDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const physician = useMemo(() => {
    const pid = referral?.physician_id;
    if (!pid) return null;
    return Object.values(storePhysicians || {}).find((p) => p.id === pid || p._id === pid) || null;
  }, [referral?.physician_id, storePhysicians]);

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
  const [preview, setPreview] = useState(null);
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
      const expiration = addCalendarDays(receivedDate, 90);
      const loggedAt = new Date().toISOString();
      // Optimistic: the F2F tab indicator (green check in the drawer) and the
      // Intake panel's "Push to Clinical RN" section both read from the store.
      // Without an optimistic write, neither updates until the next data sync.
      await updateReferralOptimistic(referral._id, {
        f2f_date: receivedDate,
        f2f_expiration: expiration,
        f2f_date_logged_by_id: appUserId || 'unknown',
        f2f_date_logged_at: loggedAt,
      });
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
      // The worker returns `{ r2Key, r2Url }` and requires the patientId in the
      // upload path so the file lands under the correct R2 prefix.
      const { r2Key, r2Url } = await uploadToR2(file, patient.id);
      const fields = {
        patient_id: patient.id,
        referral_id: referral?.id || null,
        uploaded_by_id: appUserId || 'unknown',
        file_name: file.name,
        file_type: file.type || 'application/octet-stream',
        file_size: file.size,
        r2_key: r2Key,
        r2_url: r2Url,
        category: uploadCategory,
        created_at: new Date().toISOString(),
      };
      const created = await createFile(fields);
      const newFile = { _id: created.id, ...created.fields };
      setFiles((prev) => [newFile, ...prev]);
      // Mirror into the global file store so the PatientDrawer's `hasF2FFile`
      // check (which reads from storeFiles) sees the new file immediately
      // — otherwise the F2F tab green-check waits for the next data sync.
      mergeEntities('files', { [created.id]: newFile });

      if (uploadCategory === 'F2F' && referral && !referral.f2f_date) {
        const today = new Date().toISOString().split('T')[0];
        await updateReferralOptimistic(referral._id, {
          f2f_date: today,
          f2f_expiration: addCalendarDays(today, 90),
          f2f_date_logged_by_id: appUserId || 'unknown',
          f2f_date_logged_at: new Date().toISOString(),
        });
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
            {referral.f2f_expiration && (
              <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35), marginTop: 3 }}>
                Expires {fmtDate(referral.f2f_expiration)}
              </p>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), textAlign: 'center', padding: '12px 0' }}>
            No F2F date recorded
          </p>
        )}
        {physician ? (
          <>
            <InfoRow label="Physician" value={formatPhysicianName(physician)} />
            <InfoRow
              label="PECOS"
              value={truthyFlag(physician.is_pecos_enrolled) ? 'Enrolled' : 'Not enrolled'}
              color={truthyFlag(physician.is_pecos_enrolled) ? palette.accentGreen.hex : palette.primaryMagenta.hex}
            />
            <InfoRow
              label="OPRA"
              value={truthyFlag(physician.is_opra_enrolled) ? 'Eligible' : 'Not eligible'}
              color={truthyFlag(physician.is_opra_enrolled) ? palette.accentGreen.hex : palette.primaryMagenta.hex}
            />
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), padding: '6px 0 2px', lineHeight: 1.45 }}>
            No physician linked yet — add one on the Physician tab to see PECOS / OPRA.
          </p>
        )}
      </Section>

      {/* Date of Visit — primary, obvious */}
      <Section title="Date of Visit">
        {referral.f2f_date ? (
          <div style={{
            borderRadius: 10,
            padding: '16px 14px',
            marginBottom: 12,
            background: hexToRgba(palette.accentGreen.hex, 0.08),
            border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.22)}`,
            textAlign: 'center',
          }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: 0 }}>
              Visit date
            </p>
            <p style={{ fontSize: 26, fontWeight: 800, color: palette.backgroundDark.hex, margin: '6px 0 0', letterSpacing: '-0.02em' }}>
              {fmtDate(referral.f2f_date)}
            </p>
            {(referral.f2f_date_logged_by_id || referral.f2f_date_logged_at) && (
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), margin: '8px 0 0', lineHeight: 1.4 }}>
                Logged by {referral.f2f_date_logged_by_id ? resolveUser(referral.f2f_date_logged_by_id) : '—'}
                {referral.f2f_date_logged_at ? ` · ${fmtDateTime(referral.f2f_date_logged_at)}` : ''}
              </p>
            )}
          </div>
        ) : (
          <div style={{
            borderRadius: 10,
            padding: '14px',
            marginBottom: 12,
            background: hexToRgba(palette.backgroundDark.hex, 0.03),
            border: `1px dashed ${hexToRgba(palette.backgroundDark.hex, 0.15)}`,
            textAlign: 'center',
          }}>
            <p style={{ fontSize: 14, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0 }}>
              No date of visit logged
            </p>
          </div>
        )}

        {!readOnly && can(PERMISSION_KEYS.CLINICAL_F2F) && (
          !showDatePicker ? (
            <button
              type="button"
              onClick={() => {
                if (referral.f2f_date) setReceivedDate(toCalendarDateInput(referral.f2f_date));
                setShowDatePicker(true);
              }}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 8, border: 'none',
                background: referral.f2f_date ? hexToRgba(palette.accentGreen.hex, 0.12) : palette.accentGreen.hex,
                color: referral.f2f_date ? palette.accentGreen.hex : palette.backgroundLight.hex,
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              {referral.f2f_date ? 'Update Date of Visit' : 'Log Date of Visit'}
            </button>
          ) : (
            <div style={{ borderRadius: 8, background: hexToRgba(palette.accentGreen.hex, 0.04), padding: '12px' }}>
              <p style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 8 }}>
                {referral.f2f_date ? 'Confirm or update date of visit' : 'When did the physician visit occur?'}
              </p>
              <input
                type="date"
                value={receivedDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setReceivedDate(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 7, border: `1px solid ${receivedDate ? palette.accentGreen.hex : 'var(--color-border)'}`, fontSize: 15, fontFamily: 'inherit', outline: 'none', background: palette.backgroundLight.hex, color: palette.backgroundDark.hex, marginBottom: 8 }}
              />
              {receivedDate && (
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 8 }}>
                  Expires <strong style={{ color: palette.accentOrange.hex }}>{fmtDate(addCalendarDays(receivedDate, 90))}</strong>
                </p>
              )}
              {saveError && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginBottom: 8 }}>{saveError}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={handleLogReceived} disabled={!receivedDate || saving}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 7, border: 'none', background: receivedDate && !saving ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.08), color: receivedDate && !saving ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3), fontSize: 13, fontWeight: 650, cursor: receivedDate && !saving ? 'pointer' : 'not-allowed' }}
                >
                  {saving ? 'Saving...' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowDatePicker(false); setReceivedDate(''); setSaveError(null); }} disabled={saving}
                  style={{ flex: 1, padding: '10px 0', borderRadius: 7, border: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.08), color: hexToRgba(palette.backgroundDark.hex, 0.55), fontSize: 13, fontWeight: 650, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )
        )}
      </Section>

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
          files.map((f) => {
            return (
              <div key={f._id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={palette.primaryMagenta.hex} strokeWidth="1.6" /><path d="M14 2v6h6" stroke={palette.primaryMagenta.hex} strokeWidth="1.6" /></svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12.5, fontWeight: 550, color: palette.backgroundDark.hex, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.file_name}</p>
                  <p style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{f.category} · {fmtDate(f.created_at)}</p>
                </div>
                <div style={{ display: 'flex', gap: 5, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => openFileBeside(f, patient, referral)}
                    title="Open beside patient snapshot"
                    style={{
                      padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 650,
                      background: hexToRgba(palette.primaryMagenta.hex, 0.1),
                      border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.22)}`,
                      color: palette.primaryMagenta.hex,
                    }}
                  >
                    Open to side
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreview(f)}
                    title="Preview file"
                    style={{
                      padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 650,
                      background: hexToRgba(palette.primaryDeepPlum.hex, 0.08),
                      border: `1px solid ${hexToRgba(palette.primaryDeepPlum.hex, 0.18)}`,
                      color: palette.primaryDeepPlum.hex,
                    }}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => openSignedFile(f, { download: true })}
                    title="Download file"
                    style={{
                      padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 650,
                      background: hexToRgba(palette.accentBlue.hex, 0.1),
                      border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.25)}`,
                      color: palette.accentBlue.hex,
                    }}
                  >
                    Download
                  </button>
                </div>
              </div>
            );
          })
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

        <HospitalizationReview referral={referral} patient={patient} readOnly={readOnly} />
      </Section>

      {preview && (
        <FilePreviewModal
          file={preview}
          onClose={() => setPreview(null)}
          onOpenToSide={() => openFileBeside(preview, patient, referral)}
        />
      )}
    </div>
  );
}
