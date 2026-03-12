import { useState, useEffect } from 'react';
import { getChecksByPatient, createInsuranceCheck } from '../../../api/insuranceChecks.js';
import { getAuthorizationsByReferral } from '../../../api/authorizations.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import { useLookups } from '../../../hooks/useLookups.js';
import { CHECK_FLAGS, CHECK_SOURCES, MEDICARE_OPTIONS, MEDICAID_OPTIONS, COMMERCIAL_PLANS, buildCheckFields, EMPTY_CHECK_FORM } from '../../../data/eligibilityConfig.js';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' + new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function FlagBadge({ label, value }) {
  const isTrue = value === true || value === 'true';
  const isFalse = value === false || value === 'false';
  if (!isTrue && !isFalse) return null;
  return (
    <span style={{
      fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
      background: isTrue ? hexToRgba(palette.primaryMagenta.hex, 0.12) : hexToRgba(palette.accentGreen.hex, 0.12),
      color: isTrue ? palette.primaryMagenta.hex : palette.accentGreen.hex,
    }}>
      {isTrue ? label : `No ${label}`}
    </span>
  );
}

function FieldLabel({ children }) {
  return <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 5 }}>{children}</p>;
}

const selectStyle = (highlight) => ({
  width: '100%', padding: '7px 9px', borderRadius: 8,
  border: `1px solid ${highlight ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.12)}`,
  fontSize: 13, fontFamily: 'inherit', background: palette.backgroundLight.hex, cursor: 'pointer', outline: 'none',
  fontWeight: highlight ? 600 : 400,
});

const AUTH_STATUS_COLORS = {
  Approved: { bg: hexToRgba('#22c55e', 0.12), text: '#15803d' },
  Denied:   { bg: hexToRgba('#e11d48', 0.1),  text: '#be123c' },
  Pending:  { bg: hexToRgba('#f59e0b', 0.12), text: '#b45309' },
  Expired:  { bg: hexToRgba('#6b7280', 0.1),  text: '#4b5563' },
  Appealed: { bg: hexToRgba('#8b5cf6', 0.1),  text: '#6d28d9' },
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function EligibilityTab({ patient, referral }) {
  const { appUserId, appUserName } = useCurrentAppUser();
  const { resolveUser } = useLookups();
  const [checks, setChecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_CHECK_FORM });
  const [flagValues, setFlagValues] = useState({});
  const [auths, setAuths] = useState([]);
  const [authsLoading, setAuthsLoading] = useState(false);
  const [authExpanded, setAuthExpanded] = useState(null);
  const isSN = referral?.division === 'Special Needs' || patient?.division === 'Special Needs';

  useEffect(() => {
    if (!patient?.id) return;
    setLoading(true);
    getChecksByPatient(patient.id)
      .then((recs) => setChecks(recs.map((r) => ({ _id: r.id, ...r.fields }))
        .sort((a, b) => new Date(b.check_date || 0) - new Date(a.check_date || 0))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [patient?.id]);

  useEffect(() => {
    if (!referral?.id) return;
    setAuthsLoading(true);
    getAuthorizationsByReferral(referral.id)
      .then((recs) => setAuths(
        recs.map((r) => ({ _id: r.id, ...r.fields }))
          .sort((a, b) => new Date(b.submitted_date || b.approved_date || 0) - new Date(a.submitted_date || a.approved_date || 0))
      ))
      .catch(() => {})
      .finally(() => setAuthsLoading(false));
  }, [referral?.id]);

  function openForm() {
    setForm({ ...EMPTY_CHECK_FORM });
    setFlagValues({});
    setShowForm(true);
  }

  async function submitCheck() {
    setSaving(true);
    try {
      const fields = buildCheckFields({
        referralId: referral?.id || null,
        patientId: patient.id,
        authorId: appUserId,
        form,
        flagValues,
        isSN,
      });
      const created = await createInsuranceCheck(fields);
      setChecks((prev) => [{ _id: created.id, ...created.fields }, ...prev]);
      setShowForm(false);
    } catch (err) {
      console.error('Check save failed', err);
    } finally {
      setSaving(false);
    }
  }

  const latest = checks[0] || null;

  if (loading) return <LoadingState message="Loading eligibility..." size="small" />;

  return (
    <div style={{ padding: '18px 20px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex }}>Eligibility</h3>
        <button onClick={openForm} style={{ padding: '6px 14px', borderRadius: 7, background: palette.primaryMagenta.hex, border: 'none', fontSize: 12, fontWeight: 650, color: palette.backgroundLight.hex, cursor: 'pointer' }}>
          {latest ? 'Log New Check' : 'Log First Check'}
        </button>
      </div>

      {/* Latest check summary */}
      {latest ? (
        <div style={{ padding: '14px 16px', borderRadius: 10, background: hexToRgba(palette.backgroundDark.hex, 0.03), marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
            <div>
              <p style={{ fontSize: 12.5, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2 }}>
                {resolveUser(latest.checked_by_id)}
              </p>
              <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
                {latest.check_source} · {fmt(latest.check_date)}
              </p>
            </div>
          </div>

          {/* Coverage types from summary */}
          {latest.result_summary && latest.result_summary.split('\n')
            .filter((l) => l.startsWith('Medicare:') || l.startsWith('Medicaid:'))
            .map((line, i) => {
              const [lbl, ...rest] = line.split(': ');
              const val = rest.join(': ');
              const isMgd = val.includes('Managed') || val.includes('MCO') || val.includes('Advantage');
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
                  <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>{lbl}</span>
                  <span style={{ fontSize: 12, fontWeight: 650, color: val.includes('Not enrolled') ? hexToRgba(palette.backgroundDark.hex, 0.35) : isMgd ? palette.accentOrange.hex : palette.accentBlue.hex }}>{val}</span>
                </div>
              );
            })}

          {latest.managed_care_plan && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
              <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>Plan</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: palette.backgroundDark.hex }}>{latest.managed_care_plan}</span>
            </div>
          )}
          {latest.managed_care_id && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
              <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>Exception Code</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: palette.backgroundDark.hex }}>{latest.managed_care_id}</span>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {CHECK_FLAGS.map((f) => <FlagBadge key={f.key} label={f.label} value={latest[f.key]} />)}
          </div>

          {latest.result_summary && (() => {
            const notes = latest.result_summary.split('\n').filter((l) => !l.startsWith('Medicare:') && !l.startsWith('Medicaid:') && !l.startsWith('Plan:') && !l.startsWith('Exception Code:')).join('\n').trim();
            return notes ? <p style={{ marginTop: 10, fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65), lineHeight: 1.5, fontStyle: 'italic' }}>{notes}</p> : null;
          })()}
        </div>
      ) : (
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', marginBottom: 20 }}>No eligibility checks on record.</p>
      )}

      {/* Inline form */}
      {showForm && (
        <div style={{ padding: '16px 18px', borderRadius: 12, background: hexToRgba(palette.backgroundDark.hex, 0.03), marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 14 }}>New Check</p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <FieldLabel>Source</FieldLabel>
              <select value={form.check_source} onChange={(e) => setForm((p) => ({ ...p, check_source: e.target.value }))} style={selectStyle(false)}>
                {CHECK_SOURCES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Third Party Plan</FieldLabel>
              <select value={form.managed_care_plan} onChange={(e) => setForm((p) => ({ ...p, managed_care_plan: e.target.value }))} style={selectStyle(!!form.managed_care_plan)}>
                <option value="">— None —</option>
                {COMMERCIAL_PLANS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <FieldLabel>Medicare Coverage</FieldLabel>
              <select value={form.medicare_type} onChange={(e) => setForm((p) => ({ ...p, medicare_type: e.target.value }))} style={selectStyle(!!form.medicare_type)}>
                {MEDICARE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <FieldLabel>Medicaid Coverage</FieldLabel>
              <select value={form.medicaid_type} onChange={(e) => setForm((p) => ({ ...p, medicaid_type: e.target.value }))} style={selectStyle(!!form.medicaid_type)}>
                {MEDICAID_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {isSN && (
            <div style={{ marginBottom: 12 }}>
              <FieldLabel>Exception Code (SN)</FieldLabel>
              <input value={form.exception_code} onChange={(e) => setForm((p) => ({ ...p, exception_code: e.target.value }))} placeholder="e.g. 9, 88, 0A…" style={{ width: '100%', padding: '7px 9px', borderRadius: 8, border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.12)}`, fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <FieldLabel>Flags</FieldLabel>
            {CHECK_FLAGS.map((f) => (
              <div key={f.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
                <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>{f.label}</span>
                <select value={flagValues[f.key] || ''} onChange={(e) => setFlagValues((p) => ({ ...p, [f.key]: e.target.value }))} style={{ fontSize: 12, padding: '2px 6px', borderRadius: 5, border: `1px solid var(--color-border)`, fontFamily: 'inherit' }}>
                  <option value="">—</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 12 }}>
            <FieldLabel>Notes</FieldLabel>
            <textarea value={form.result_summary} onChange={(e) => setForm((p) => ({ ...p, result_summary: e.target.value }))} placeholder="Findings, observations…" rows={3} style={{ width: '100%', padding: '7px 9px', borderRadius: 8, border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.12)}`, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
            <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 3 }}>Logged by {appUserName}</p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: '8px 0', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.07), border: 'none', fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>Cancel</button>
            <button onClick={submitCheck} disabled={saving} style={{ flex: 2, padding: '8px 0', borderRadius: 8, background: palette.primaryMagenta.hex, border: 'none', fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : 'Save Check'}
            </button>
          </div>
        </div>
      )}

      {/* ── Authorizations ── */}
      <div style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 12 }}>
          Prior Authorizations
        </p>

        {authsLoading ? (
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.35) }}>Loading…</p>
        ) : auths.length === 0 ? (
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No authorization records on file.</p>
        ) : auths.map((a) => {
          const sc = AUTH_STATUS_COLORS[a.status] || AUTH_STATUS_COLORS.Pending;
          const isOpen = authExpanded === a._id;
          return (
            <div
              key={a._id}
              onClick={() => setAuthExpanded(isOpen ? null : a._id)}
              style={{
                padding: '12px 14px', borderRadius: 9, marginBottom: 8, cursor: 'pointer',
                border: `1px solid ${isOpen ? hexToRgba(palette.backgroundDark.hex, 0.1) : hexToRgba(palette.backgroundDark.hex, 0.07)}`,
                background: isOpen ? hexToRgba(palette.backgroundDark.hex, 0.02) : 'transparent',
                transition: 'all 0.15s',
              }}
            >
              {/* Row header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ fontSize: 12.5, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2 }}>
                    {a.plan_name || 'Unknown Plan'}
                    {a.auth_number && <span style={{ fontWeight: 400, fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginLeft: 6 }}>#{a.auth_number}</span>}
                  </p>
                  <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
                    {a.submitted_date ? `Submitted ${fmtDate(a.submitted_date)}` : a.approved_date ? `Approved ${fmtDate(a.approved_date)}` : 'No date recorded'}
                  </p>
                </div>
                <span style={{ fontSize: 11, fontWeight: 650, padding: '3px 9px', borderRadius: 20, background: sc.bg, color: sc.text, flexShrink: 0 }}>
                  {a.status || 'Pending'}
                </span>
              </div>

              {/* Expanded detail */}
              {isOpen && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
                  {a.services_authorized?.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <p style={{ fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 4 }}>Services Authorized</p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {(Array.isArray(a.services_authorized) ? a.services_authorized : a.services_authorized.split(',')).map((s) => (
                          <span key={s} style={{ fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: hexToRgba(palette.accentGreen.hex, 0.1), color: '#15803d' }}>{s.trim()}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {(a.effective_start || a.effective_end) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>Auth Window</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: palette.backgroundDark.hex }}>
                        {fmtDate(a.effective_start)} – {fmtDate(a.effective_end)}
                      </span>
                    </div>
                  )}
                  {a.approved_date && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>Approved</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#15803d' }}>{fmtDate(a.approved_date)}</span>
                    </div>
                  )}
                  {a.denial_reason && (
                    <div style={{ padding: '6px 10px', borderRadius: 6, background: hexToRgba('#e11d48', 0.06), marginTop: 6 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#be123c', marginBottom: 2 }}>Denial Reason</p>
                      <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.7), lineHeight: 1.5 }}>{a.denial_reason}</p>
                    </div>
                  )}
                  {a.notes && (
                    <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.5, marginTop: 6, fontStyle: 'italic' }}>{a.notes}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* History */}
      {checks.length > 1 && (
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 10 }}>
            History ({checks.length - 1} previous)
          </p>
          {checks.slice(1).map((c) => (
            <div key={c._id} onClick={() => setExpanded(expanded === c._id ? null : c._id)} style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 6, cursor: 'pointer', background: expanded === c._id ? hexToRgba(palette.backgroundDark.hex, 0.03) : 'transparent' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <p style={{ fontSize: 12.5, fontWeight: 550, color: palette.backgroundDark.hex }}>
                  {resolveUser(c.checked_by_id)} — {c.check_source}
                </p>
                <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{c.check_date ? new Date(c.check_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</p>
              </div>
              {expanded === c._id && c.result_summary && (
                <p style={{ marginTop: 8, fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6), lineHeight: 1.5 }}>{c.result_summary}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
