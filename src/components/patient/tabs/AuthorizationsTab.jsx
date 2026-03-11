import { useState, useEffect } from 'react';
import { getAuthorizationsByReferral } from '../../../api/authorizations.js';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

const STATUS_COLORS = {
  Pending: { bg: hexToRgba(palette.highlightYellow.hex, 0.15), text: '#7A5F00' },
  Approved: { bg: hexToRgba(palette.accentGreen.hex, 0.12), text: '#3A6E00' },
  Denied: { bg: hexToRgba(palette.primaryMagenta.hex, 0.1), text: palette.primaryMagenta.hex },
  Expired: { bg: hexToRgba(palette.backgroundDark.hex, 0.07), text: hexToRgba(palette.backgroundDark.hex, 0.45) },
  Appealed: { bg: hexToRgba(palette.accentOrange.hex, 0.12), text: '#8B4A00' },
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AuthorizationsTab({ referral }) {
  const [auths, setAuths] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!referral?.id) { setLoading(false); return; }
    setLoading(true);
    getAuthorizationsByReferral(referral.id)
      .then((records) => setAuths(records.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [referral?.id]);

  if (!referral) return <p style={{ padding: 24, fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic', textAlign: 'center' }}>No referral selected.</p>;
  if (loading) return <LoadingState message="Loading authorizations..." size="small" />;

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex }}>Authorizations</h3>
        <button style={{ padding: '6px 14px', borderRadius: 7, background: palette.primaryMagenta.hex, border: 'none', fontSize: 12, fontWeight: 650, color: palette.backgroundLight.hex, cursor: 'pointer' }}>
          + Auth
        </button>
      </div>

      {auths.length === 0 ? (
        <p style={{ textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), padding: '32px 0', fontStyle: 'italic' }}>
          No authorization records for this referral.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {auths.map((auth) => {
            const sc = STATUS_COLORS[auth.status] || STATUS_COLORS.Pending;
            return (
              <div key={auth._id} style={{ padding: '14px 16px', borderRadius: 10, border: `1px solid var(--color-border)`, background: palette.backgroundLight.hex }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <p style={{ fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2 }}>{auth.plan_name || '—'}</p>
                    {auth.auth_number && <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>Auth # {auth.auth_number}</p>}
                  </div>
                  <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: sc.bg, color: sc.text }}>{auth.status}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 12 }}>
                  <div>
                    <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Submitted: </span>
                    <span style={{ color: palette.backgroundDark.hex }}>{fmtDate(auth.submitted_date)}</span>
                  </div>
                  <div>
                    <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Approved: </span>
                    <span style={{ color: palette.backgroundDark.hex }}>{fmtDate(auth.approved_date)}</span>
                  </div>
                  <div>
                    <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Effective: </span>
                    <span style={{ color: palette.backgroundDark.hex }}>{fmtDate(auth.effective_start)} – {fmtDate(auth.effective_end)}</span>
                  </div>
                  {auth.services_authorized?.length > 0 && (
                    <div>
                      <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Services: </span>
                      <span style={{ color: palette.backgroundDark.hex }}>{(Array.isArray(auth.services_authorized) ? auth.services_authorized : [auth.services_authorized]).join(', ')}</span>
                    </div>
                  )}
                </div>
                {auth.denial_reason && (
                  <div style={{ marginTop: 10, padding: '8px 10px', background: hexToRgba(palette.primaryMagenta.hex, 0.06), borderRadius: 7, fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.7) }}>
                    <strong style={{ color: palette.primaryMagenta.hex }}>Denial: </strong>{auth.denial_reason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
