import { useState } from 'react';
import { getFilesByReferral } from '../../../api/patientFiles.js';
import { usePatientDrawer } from '../../../context/PatientDrawerContext.jsx';
import StageBadge from '../../common/StageBadge.jsx';
import DivisionBadge from '../../common/DivisionBadge.jsx';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

const DOC_CATEGORIES = ['F2F', 'MD Orders'];

function formatBytes(b) {
  if (!b) return '';
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function FilesSection({ referralId, onClose }) {
  const [files, setFiles] = useState(null);
  const [loading, setLoading] = useState(false);

  function load() {
    if (files !== null) { onClose(); return; }
    setLoading(true);
    getFilesByReferral(referralId)
      .then((recs) => {
        const all = recs.map((r) => ({ _id: r.id, ...r.fields }));
        setFiles(all.filter((f) => DOC_CATEGORIES.includes(f.category) || !f.category));
      })
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }

  if (files === null) return (
    <button onClick={load} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, background: hexToRgba(palette.accentBlue.hex, 0.1), border: 'none', fontSize: 11.5, fontWeight: 650, color: palette.accentBlue.hex, cursor: 'pointer' }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeWidth="1.7"/><path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>
      View Files
    </button>
  );

  if (loading) return <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Loading…</span>;

  return (
    <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, background: hexToRgba(palette.accentBlue.hex, 0.06) }}>
      {files.length === 0 ? (
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>No F2F or MD Order files on record.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {files.map((f) => {
            const cleanUrl = f.r2_url?.replace(/[<>\n]/g, '').trim();
            return (
              <div key={f._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <p style={{ fontSize: 12.5, fontWeight: 550, color: palette.backgroundDark.hex }}>{f.file_name}</p>
                  <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                    {f.category} {f.file_size ? `· ${formatBytes(f.file_size)}` : ''} {f.created_at ? `· ${new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                  </p>
                </div>
                {cleanUrl && (
                  <a href={cleanUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, fontWeight: 650, color: palette.accentBlue.hex, textDecoration: 'none', flexShrink: 0 }}>Open</a>
                )}
              </div>
            );
          })}
        </div>
      )}
      <button onClick={() => setFiles(null)} style={{ marginTop: 8, fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>Hide files</button>
    </div>
  );
}

export default function PhysicianPatientsTab({ referrals, loading }) {
  const { open: openPatient } = usePatientDrawer();
  const [expanded, setExpanded] = useState(null);

  if (loading) return <LoadingState message="Loading patients…" size="small" />;
  if (!referrals.length) return <p style={{ padding: '32px 22px', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), textAlign: 'center', fontStyle: 'italic' }}>No referrals linked to this physician.</p>;

  return (
    <div style={{ padding: '16px 22px 40px' }}>
      <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 14 }}>
        {referrals.length} patient{referrals.length !== 1 ? 's' : ''} · double-click to open patient snapshot
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {referrals.map((ref) => (
          <div key={ref._id} style={{ padding: '12px 14px', borderRadius: 10, background: hexToRgba(palette.backgroundDark.hex, 0.025) }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div
                onDoubleClick={() => openPatient({ id: ref.patient_id, _id: ref.patient_id, division: ref.division }, ref)}
                style={{ cursor: 'default' }}
                title="Double-click to open patient"
              >
                <p style={{ fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 4 }}>{ref.patientName || ref.patient_id}</p>
                <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                  <DivisionBadge division={ref.division} size="small" />
                  <StageBadge stage={ref.current_stage} size="small" />
                </div>
              </div>
              <FilesSection
                referralId={ref.id}
                onClose={() => setExpanded(null)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
