import { useState, useEffect } from 'react';
import { getFilesByPatient } from '../../api/patientFiles.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { canPerformClinicalRnReview } from '../../data/permissionKeys.js';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import FilePreviewModal from '../common/FilePreviewModal.jsx';
import { markClinicalLeadViable, isClinicalLeadPreCheck } from '../../utils/clinicalLeadPreCheck.js';
import { openSignedFile } from '../../utils/r2Upload.js';
import palette, { hexToRgba } from '../../utils/colors.js';

function filePatient(referral) {
  if (!referral) return null;
  if (referral.patient) {
    return { id: referral.patient.id || referral.patient_id, ...referral.patient };
  }
  return { id: referral.patient_id };
}

export default function ClinicalLeadPreCheckPanel({
  referrals = [],
  selectedReferral,
  onOpenFiles,
  onSelectedReferralLeftModule,
}) {
  const { can: canPerm } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const { openFileBeside } = usePatientDrawer();
  const canMark = canPerformClinicalRnReview(canPerm);

  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filePreview, setFilePreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const preCheckCount = referrals.filter(isClinicalLeadPreCheck).length;
  const reviewCount = referrals.length - preCheckCount;

  useEffect(() => {
    setFilePreview(null);
    setError(null);
    setSaving(false);
  }, [selectedReferral?._id]);

  useEffect(() => {
    const pid = selectedReferral?.patient_id;
    if (!pid) { setFiles([]); return undefined; }
    let cancelled = false;
    setFilesLoading(true);
    getFilesByPatient(pid)
      .then((recs) => {
        if (cancelled) return;
        const mapped = recs.map((r) => ({ _id: r.id, ...r.fields }));
        setFiles(mapped.filter((f) => !f.archived_at));
      })
      .catch(() => { if (!cancelled) setFiles([]); })
      .finally(() => { if (!cancelled) setFilesLoading(false); });
    return () => { cancelled = true; };
  }, [selectedReferral?.patient_id]);

  async function handleMarkViable() {
    if (!selectedReferral || !canMark || saving) return;
    setSaving(true);
    setError(null);
    try {
      await markClinicalLeadViable({
        referral: selectedReferral,
        appUserId,
        onLeftModule: onSelectedReferralLeftModule,
      });
    } catch (err) {
      setError(err?.message || 'Could not mark viable.');
      setSaving(false);
    }
  }

  const patient = filePatient(selectedReferral);

  return (
    <div style={{
      width: 320, minWidth: 320, borderLeft: '1px solid #E6E4EB',
      background: '#F3F2F6', overflowY: 'auto', flexShrink: 0, padding: '16px 14px',
    }}>
      <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: '1px solid #E6E4EB' }}>
        <p style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
          color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 8,
        }}>
          Queue
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
          <span style={{ fontSize: 12, color: '#5A5466' }}>Lead pre-check</span>
          <span style={{ fontSize: 12.5, fontWeight: 650, color: palette.primaryDeepPlum.hex }}>{preCheckCount}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
          <span style={{ fontSize: 12, color: '#5A5466' }}>Clinical review</span>
          <span style={{ fontSize: 12.5, fontWeight: 650, color: palette.backgroundDark.hex }}>{reviewCount}</span>
        </div>
      </div>

      {!selectedReferral ? (
        <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>
          Select a lead to review files and mark viable.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
              background: hexToRgba(palette.primaryDeepPlum.hex, 0.1),
              color: palette.primaryDeepPlum.hex, letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>
              Lead Pre-Check
            </span>
            <span style={{
              fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
              background: hexToRgba(palette.accentBlue.hex, 0.1),
              color: palette.accentBlue.hex, letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>
              also in Leads
            </span>
          </div>

          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.45, marginBottom: 14 }}>
            Glance the chart. This is not the full clinical review.
          </p>

          {canMark && (
            <button
              type="button"
              data-testid="mark-viable-btn"
              onClick={handleMarkViable}
              disabled={saving}
              style={{
                width: '100%', padding: '11px 14px', borderRadius: 8, border: 'none',
                background: palette.accentGreen.hex,
                color: palette.backgroundLight.hex,
                fontSize: 13.5, fontWeight: 700, cursor: saving ? 'wait' : 'pointer',
                textAlign: 'left', letterSpacing: '-0.01em', marginBottom: 14,
              }}
            >
              {saving ? 'Saving…' : 'Mark Viable'}
            </button>
          )}
          {!canMark && (
            <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic', marginBottom: 14 }}>
              You do not have permission to sign off on this check.
            </p>
          )}
          {error && (
            <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, fontWeight: 600, marginBottom: 12 }}>{error}</p>
          )}

          <div style={{ marginBottom: 4, paddingBottom: 14, borderBottom: '1px solid #E6E4EB' }}>
            <p style={{
              fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
              color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 8,
            }}>
              Files
            </p>
            {filesLoading ? (
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Loading…</p>
            ) : files.length === 0 ? (
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>
                No files uploaded yet.
              </p>
            ) : (
              files.map((f) => (
                <div
                  key={f._id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
                    borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke={palette.primaryDeepPlum.hex} strokeWidth="1.6" />
                    <path d="M14 2v6h6" stroke={palette.primaryDeepPlum.hex} strokeWidth="1.6" />
                  </svg>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p title={f.file_name} style={{
                      fontSize: 11.5, fontWeight: 550, color: palette.backgroundDark.hex,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {f.file_name}
                    </p>
                    <p style={{ fontSize: 10, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                      {f.category || 'File'}
                      {f.created_at ? ` · ${new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {f.r2_key && (
                      <button
                        type="button"
                        onClick={() => setFilePreview(f)}
                        title="Preview"
                        style={{
                          padding: '3px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 10.5, fontWeight: 650,
                          background: hexToRgba(palette.primaryDeepPlum.hex, 0.08),
                          border: `1px solid ${hexToRgba(palette.primaryDeepPlum.hex, 0.18)}`,
                          color: palette.primaryDeepPlum.hex,
                        }}
                      >
                        Preview
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openFileBeside(f, patient, selectedReferral)}
                      title="Open beside patient snapshot"
                      style={{
                        padding: '3px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 10.5, fontWeight: 650,
                        background: hexToRgba(palette.primaryMagenta.hex, 0.08),
                        border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.2)}`,
                        color: palette.primaryMagenta.hex,
                      }}
                    >
                      Side
                    </button>
                    {f.r2_key && (
                      <button
                        type="button"
                        onClick={() => openSignedFile(f, { download: true })}
                        title="Download"
                        style={{
                          padding: '3px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 10.5, fontWeight: 650,
                          background: hexToRgba(palette.accentBlue.hex, 0.1),
                          border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.25)}`,
                          color: palette.accentBlue.hex,
                        }}
                      >
                        Save
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
            <button
              type="button"
              onClick={() => onOpenFiles?.(selectedReferral)}
              style={{
                marginTop: 8, width: '100%', padding: '6px 0', borderRadius: 6,
                background: 'none', border: `1px dashed ${hexToRgba(palette.backgroundDark.hex, 0.18)}`,
                fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer',
              }}
            >
              Open files to the side
            </button>
          </div>
        </>
      )}

      {filePreview && (
        <FilePreviewModal
          file={filePreview}
          onClose={() => setFilePreview(null)}
          onOpenToSide={() => {
            openFileBeside(filePreview, patient, selectedReferral);
            setFilePreview(null);
          }}
        />
      )}
    </div>
  );
}
