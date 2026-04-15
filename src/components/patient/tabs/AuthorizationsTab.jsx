import { useState, useEffect } from 'react';
import { getAuthorizationsByReferral, createAuthorization } from '../../../api/authorizations.js';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';

const AUTH_SERVICES = ['SN', 'PT', 'OT', 'ST', 'HHA', 'ABA'];

const STATUS_COLORS = {
  Pending:  { bg: hexToRgba(palette.highlightYellow.hex, 0.15), text: '#7A5F00' },
  Approved: { bg: hexToRgba(palette.accentGreen.hex, 0.12),     text: '#3A6E00' },
  Denied:   { bg: hexToRgba(palette.primaryMagenta.hex, 0.1),   text: palette.primaryMagenta.hex },
  Expired:  { bg: hexToRgba(palette.backgroundDark.hex, 0.07),  text: hexToRgba(palette.backgroundDark.hex, 0.45) },
  Appealed: { bg: hexToRgba(palette.accentOrange.hex, 0.12),    text: '#8B4A00' },
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '7px 9px', borderRadius: 7, marginBottom: 8,
  border: `1px solid var(--color-border)`,
  fontSize: 13, fontFamily: 'inherit', outline: 'none',
  background: palette.backgroundLight.hex,
  color: palette.backgroundDark.hex,
};

export default function AuthorizationsTab({ referral, readOnly = false }) {
  const [auths, setAuths]     = useState([]);
  const [loading, setLoading] = useState(true);
  const { can } = usePermissions();

  // form mode: null | 'pick' | 'approval' | 'denial'
  const [mode, setMode]           = useState(null);
  const [saving, setSaving]       = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Approval fields
  const [authNumber, setAuthNumber]   = useState('');
  const [approvedDate, setApprovedDate] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd]     = useState('');
  const [servicesAuth, setServicesAuth] = useState([]);

  // Denial fields
  const [denialReason, setDenialReason] = useState('');

  function loadAuths() {
    if (!referral?.id) { setLoading(false); return; }
    setLoading(true);
    getAuthorizationsByReferral(referral.id)
      .then((records) => setAuths(records.map((r) => ({ _id: r.id, ...r.fields }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(loadAuths, [referral?.id]);

  function openForm() {
    setAuthNumber(''); setApprovedDate(''); setWindowStart(''); setWindowEnd(''); setServicesAuth([]);
    setDenialReason('');
    setSaveError(null);
    setMode('pick');
  }

  function cancelForm() {
    setMode(null);
    setSaveError(null);
  }

  function toggleService(s) {
    setServicesAuth((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);
  }

  async function handleApproval() {
    if (!can(PERMISSION_KEYS.AUTH_DECIDE)) return;
    if (!approvedDate || !referral) return;
    setSaving(true); setSaveError(null);
    try {
      await createAuthorization({
        referral_id: referral.id,
        plan_name: referral.patient?.insurance_plan || '',
        status: 'Approved',
        approved_date: approvedDate,
        ...(authNumber.trim()   && { auth_number: authNumber.trim() }),
        ...(windowStart         && { effective_start: windowStart }),
        ...(windowEnd           && { effective_end: windowEnd }),
        ...(servicesAuth.length && { services_authorized: servicesAuth }),
      });
      setMode(null);
      loadAuths();
    } catch (err) {
      setSaveError(err.message || 'Failed to save');
      setSaving(false);
    }
  }

  async function handleDenial() {
    if (!can(PERMISSION_KEYS.AUTH_DECIDE)) return;
    if (!referral) return;
    setSaving(true); setSaveError(null);
    try {
      await createAuthorization({
        referral_id: referral.id,
        plan_name: referral.patient?.insurance_plan || '',
        status: 'Denied',
        ...(denialReason.trim() && { denial_reason: denialReason.trim() }),
      });
      setMode(null);
      loadAuths();
    } catch (err) {
      setSaveError(err.message || 'Failed to save');
      setSaving(false);
    }
  }

  if (!referral) return (
    <p style={{ padding: 24, fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic', textAlign: 'center' }}>
      No referral selected.
    </p>
  );
  if (loading) return <LoadingState message="Loading authorizations..." size="small" />;

  return (
    <div style={{ padding: '20px' }}>

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex }}>Authorizations</h3>
        {mode === null && !readOnly && can(PERMISSION_KEYS.AUTH_DECIDE) && (
          <button
            onClick={openForm}
            style={{
              padding: '6px 14px', borderRadius: 7, border: 'none',
              background: palette.accentGreen.hex,
              color: palette.backgroundLight.hex,
              fontSize: 12, fontWeight: 650, cursor: 'pointer',
              transition: 'filter 0.12s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
          >
            + Record Auth
          </button>
        )}
      </div>

      {/* ── Mode picker ── */}
      {mode === 'pick' && !readOnly && (
        <div style={{ marginBottom: 18, borderRadius: 10, border: `1px solid var(--color-border)`, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid var(--color-border)`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex }}>Record Authorization</p>
            <button onClick={cancelForm} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: hexToRgba(palette.backgroundDark.hex, 0.35), lineHeight: 1 }}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            <button
              onClick={() => setMode('approval')}
              style={{
                padding: '18px 20px', background: hexToRgba(palette.accentGreen.hex, 0.05), border: 'none',
                borderRight: `1px solid var(--color-border)`,
                cursor: 'pointer', textAlign: 'left', transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.accentGreen.hex, 0.1))}
              onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(palette.accentGreen.hex, 0.05))}
            >
              <p style={{ fontSize: 13, fontWeight: 700, color: palette.accentGreen.hex, marginBottom: 4 }}>✓ Record Approval</p>
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>Auth granted — log number, dates &amp; services</p>
            </button>
            <button
              onClick={() => setMode('denial')}
              style={{
                padding: '18px 20px', background: hexToRgba(palette.accentOrange.hex, 0.05), border: 'none',
                cursor: 'pointer', textAlign: 'left', transition: 'background 0.12s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.accentOrange.hex, 0.1))}
              onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(palette.accentOrange.hex, 0.05))}
            >
              <p style={{ fontSize: 13, fontWeight: 700, color: palette.accentOrange.hex, marginBottom: 4 }}>✕ Record Denial</p>
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>Auth denied — log reason for record</p>
            </button>
          </div>
        </div>
      )}

      {/* ── Approval form ── */}
      {mode === 'approval' && !readOnly && (
        <div style={{ marginBottom: 18, borderRadius: 10, border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.35)}`, background: hexToRgba(palette.accentGreen.hex, 0.03) }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.2)}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: palette.accentGreen.hex }}>Record Approval</p>
            <button onClick={cancelForm} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: hexToRgba(palette.backgroundDark.hex, 0.35), lineHeight: 1 }}>×</button>
          </div>
          <div style={{ padding: '14px 16px' }}>

            <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Auth Number (optional)</label>
            <input type="text" placeholder="e.g. AUTH-12345" value={authNumber} onChange={(e) => setAuthNumber(e.target.value)} style={inputStyle} />

            <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Approval Date *</label>
            <input
              type="date"
              value={approvedDate}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => setApprovedDate(e.target.value)}
              style={{ ...inputStyle, borderColor: approvedDate ? palette.accentGreen.hex : undefined }}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Window Start</label>
                <input type="date" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} style={{ ...inputStyle, marginBottom: 0 }} />
              </div>
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Window End</label>
                <input type="date" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} style={{ ...inputStyle, marginBottom: 0 }} />
              </div>
            </div>

            <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', margin: '12px 0 6px' }}>Services Authorized</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {AUTH_SERVICES.map((s) => (
                <button key={s} onClick={() => toggleService(s)} style={{
                  padding: '4px 12px', borderRadius: 6,
                  border: `1px solid ${servicesAuth.includes(s) ? palette.accentGreen.hex : 'var(--color-border)'}`,
                  fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                  background: servicesAuth.includes(s) ? palette.accentGreen.hex : 'none',
                  color: servicesAuth.includes(s) ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.6),
                  transition: 'all 0.1s',
                }}>{s}</button>
              ))}
            </div>

            {saveError && (
              <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginBottom: 10, padding: '6px 10px', borderRadius: 6, background: hexToRgba(palette.primaryMagenta.hex, 0.07) }}>
                {saveError}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={cancelForm} disabled={saving} style={{
                flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: hexToRgba(palette.backgroundDark.hex, 0.07),
                color: hexToRgba(palette.backgroundDark.hex, 0.55),
                fontSize: 12.5, fontWeight: 650,
              }}>Cancel</button>
              <button onClick={handleApproval} disabled={!approvedDate || saving} style={{
                flex: 2, padding: '8px 0', borderRadius: 7, border: 'none',
                cursor: approvedDate && !saving ? 'pointer' : 'not-allowed',
                background: approvedDate && !saving ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                color: approvedDate && !saving ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3),
                fontSize: 12.5, fontWeight: 700,
                transition: 'filter 0.12s',
              }}
                onMouseEnter={(e) => approvedDate && !saving && (e.currentTarget.style.filter = 'brightness(1.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
              >{saving ? 'Saving…' : 'Confirm Approval'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Denial form ── */}
      {mode === 'denial' && !readOnly && (
        <div style={{ marginBottom: 18, borderRadius: 10, border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.35)}`, background: hexToRgba(palette.accentOrange.hex, 0.03) }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.2)}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: palette.accentOrange.hex }}>Record Denial</p>
            <button onClick={cancelForm} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: hexToRgba(palette.backgroundDark.hex, 0.35), lineHeight: 1 }}>×</button>
          </div>
          <div style={{ padding: '14px 16px' }}>

            <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Denial Reason</label>
            <textarea
              value={denialReason}
              onChange={(e) => setDenialReason(e.target.value)}
              rows={3}
              placeholder="Describe the reason for denial..."
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55 }}
            />

            {saveError && (
              <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginBottom: 10, padding: '6px 10px', borderRadius: 6, background: hexToRgba(palette.primaryMagenta.hex, 0.07) }}>
                {saveError}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={cancelForm} disabled={saving} style={{
                flex: 1, padding: '8px 0', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: hexToRgba(palette.backgroundDark.hex, 0.07),
                color: hexToRgba(palette.backgroundDark.hex, 0.55),
                fontSize: 12.5, fontWeight: 650,
              }}>Cancel</button>
              <button onClick={handleDenial} disabled={saving} style={{
                flex: 2, padding: '8px 0', borderRadius: 7, border: 'none',
                cursor: !saving ? 'pointer' : 'not-allowed',
                background: !saving ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.07),
                color: !saving ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3),
                fontSize: 12.5, fontWeight: 700,
                transition: 'filter 0.12s',
              }}
                onMouseEnter={(e) => !saving && (e.currentTarget.style.filter = 'brightness(1.08)')}
                onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
              >{saving ? 'Saving…' : 'Confirm Denial'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Auth list ── */}
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
                  <div style={{ marginTop: 10, padding: '8px 10px', background: hexToRgba(palette.accentOrange.hex, 0.07), borderRadius: 7, fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.7) }}>
                    <strong style={{ color: palette.accentOrange.hex }}>Denial: </strong>{auth.denial_reason}
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
