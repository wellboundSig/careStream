import { useState } from 'react';
import palette, { hexToRgba } from '../../utils/colors.js';

// Shared panel wrapper ────────────────────────────────────────────────────────
function Panel({ children }) {
  return (
    <div style={{
      width: 280, minWidth: 280, borderLeft: `1px solid var(--color-border)`,
      background: hexToRgba(palette.backgroundDark.hex, 0.015),
      overflowY: 'auto', flexShrink: 0, padding: '16px 14px',
    }}>
      {children}
    </div>
  );
}

function PanelSection({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.35), marginBottom: 10 }}>{title}</p>
      {children}
    </div>
  );
}

function InfoRow({ label, value, highlight }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
      <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: highlight || palette.backgroundDark.hex }}>{value || '—'}</span>
    </div>
  );
}

function ActionBtn({ label, variant = 'default', onClick }) {
  const styles = {
    default:  { bg: hexToRgba(palette.backgroundDark.hex, 0.07),  color: hexToRgba(palette.backgroundDark.hex, 0.7) },
    primary:  { bg: palette.primaryMagenta.hex,                    color: palette.backgroundLight.hex },
    success:  { bg: palette.accentGreen.hex,                       color: palette.backgroundLight.hex },
    warning:  { bg: palette.accentOrange.hex,                      color: palette.backgroundLight.hex },
    danger:   { bg: palette.primaryMagenta.hex,                    color: palette.backgroundLight.hex },
  };
  const s = styles[variant] || styles.default;
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', padding: '8px 12px', borderRadius: 8,
        fontSize: 12.5, fontWeight: 650, cursor: 'pointer', marginBottom: 6,
        background: s.bg, color: s.color, border: 'none',
        textAlign: 'left', transition: 'filter 0.12s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.1)')}
      onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
    >
      {label}
    </button>
  );
}

function CheckItem({ label, done, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer', fontSize: 12.5, color: done ? hexToRgba(palette.backgroundDark.hex, 0.4) : palette.backgroundDark.hex }}>
      <input type="checkbox" checked={!!done} onChange={(e) => onChange?.(e.target.checked)} style={{ accentColor: palette.primaryMagenta.hex, width: 14, height: 14, flexShrink: 0 }} />
      <span style={{ textDecoration: done ? 'line-through' : 'none' }}>{label}</span>
    </label>
  );
}

function EmptyPanelState({ message }) {
  return <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic', textAlign: 'center', paddingTop: 24 }}>{message || 'Select a patient to see details.'}</p>;
}

// ── 1. Lead Entry ─────────────────────────────────────────────────────────────
function LeadEntryPanel({ referrals, resolveSource }) {
  const today = referrals.filter((r) => {
    const d = new Date(r.referral_date);
    return Date.now() - d.getTime() < 86400000;
  }).length;
  const thisWeek = referrals.filter((r) => {
    const d = new Date(r.referral_date);
    return Date.now() - d.getTime() < 7 * 86400000;
  }).length;

  return (
    <Panel>
      <PanelSection title="Intake Stats">
        <InfoRow label="Today" value={today} highlight={today > 0 ? palette.primaryMagenta.hex : null} />
        <InfoRow label="This week" value={thisWeek} />
        <InfoRow label="Total in queue" value={referrals.length} />
      </PanelSection>

      <PanelSection title="Quick Actions">
        <ActionBtn label="+ New Referral" variant="primary" onClick={() => {}} />
        <ActionBtn label="Check Duplicates" />
      </PanelSection>

      <PanelSection title="Source Breakdown">
        {(() => {
          const counts = {};
          referrals.forEach((r) => {
            const raw = r.referral_source_id || 'Unknown';
            const label = resolveSource ? resolveSource(raw) : raw;
            counts[label] = (counts[label] || 0) + 1;
          });
          const sorted = Object.entries(counts).sort(([, a], [, b]) => b - a);
          return sorted.length === 0
            ? <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No data yet.</p>
            : sorted.slice(0, 7).map(([label, n]) => (
                <InfoRow key={label} label={label} value={n} />
              ));
        })()}
      </PanelSection>
    </Panel>
  );
}

// ── 2. Intake ─────────────────────────────────────────────────────────────────
function IntakePanel({ referrals, selectedReferral }) {
  const REQUIRED_FIELDS = ['first_name', 'last_name', 'dob', 'phone_primary', 'address_street', 'medicaid_number'];
  const p = selectedReferral?.patient;
  const filled = p ? REQUIRED_FIELDS.filter((f) => p[f]).length : 0;
  const pct = p ? Math.round((filled / REQUIRED_FIELDS.length) * 100) : 0;

  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Demographics Completeness">
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>Completion</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: pct === 100 ? palette.accentGreen.hex : pct > 50 ? palette.accentOrange.hex : palette.primaryMagenta.hex }}>{pct}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: hexToRgba(palette.backgroundDark.hex, 0.08), overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? palette.accentGreen.hex : pct > 50 ? palette.accentOrange.hex : palette.primaryMagenta.hex, borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
            </div>
            {REQUIRED_FIELDS.map((f) => (
              <CheckItem key={f} label={f.replace(/_/g, ' ')} done={!!(p?.[f])} />
            ))}
          </PanelSection>

          <PanelSection title="Triage Form">
            <div style={{ padding: '10px 12px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, textAlign: 'center', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
              {selectedReferral.division === 'Special Needs' ? 'Open Triage tab to fill or view form' : 'Triage form — ALF only (not required)'}
            </div>
          </PanelSection>

          <PanelSection title="Quick Actions">
            <ActionBtn label="Open Triage Form" variant="primary" />
            <ActionBtn label="Move to Eligibility" variant="success" />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 3. Eligibility ────────────────────────────────────────────────────────────
function EligibilityPanel({ referrals, selectedReferral }) {
  const flags = ['has_open_hh_episode', 'hospice_overlap', 'snf_present', 'cdpap_active', 'disenrollment_needed'];
  return (
    <Panel>
      <PanelSection title="Queue Summary">
        <InfoRow label="Awaiting check" value={referrals.filter((r) => !r.medicaid_number).length} />
        <InfoRow label="Total in queue" value={referrals.length} />
      </PanelSection>
      <PanelSection title="Quick Actions">
        <ActionBtn label="Batch Recheck All" variant="primary" />
        <ActionBtn label="Flag Conflicts" variant="warning" />
      </PanelSection>
      <PanelSection title="Common Flags">
        {flags.map((f) => (
          <div key={f} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, fontSize: 12 }}>
            <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>{f.replace(/_/g, ' ')}</span>
            <span style={{ fontWeight: 600, color: palette.primaryMagenta.hex }}>
              {referrals.filter((r) => r[f] === true || r[f] === 'true').length}
            </span>
          </div>
        ))}
      </PanelSection>
    </Panel>
  );
}

// ── 4. Disenrollment ─────────────────────────────────────────────────────────
function DisenrollmentPanel({ selectedReferral }) {
  const [checks, setChecks] = useState({ contacted_agency: false, discharge_confirmed: false, medicaid_updated: false, eligibility_clear: false });
  const toggle = (k) => setChecks((prev) => ({ ...prev, [k]: !prev[k] }));
  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Disenrollment Checklist">
            {Object.entries(checks).map(([k, v]) => (
              <CheckItem key={k} label={k.replace(/_/g, ' ')} done={v} onChange={() => toggle(k)} />
            ))}
          </PanelSection>
          <PanelSection title="Actions">
            <ActionBtn label="Discharge Confirmed" variant="success" />
            <ActionBtn label="Escalate to Conflict" variant="warning" />
            <ActionBtn label="Move to NTUC" variant="danger" />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 5. F2F/MD Orders Pending ──────────────────────────────────────────────────
function F2FPanel({ referrals, selectedReferral }) {
  function daysLeft(exp) {
    if (!exp) return null;
    return Math.ceil((new Date(exp) - Date.now()) / 86400000);
  }
  const ref = selectedReferral;
  const days = ref ? daysLeft(ref.f2f_expiration) : null;
  const urgencyColor = days === null ? null : days < 0 ? palette.primaryMagenta.hex : days <= 7 ? palette.primaryMagenta.hex : days <= 14 ? palette.accentOrange.hex : days <= 30 ? palette.highlightYellow.hex : palette.accentGreen.hex;

  return (
    <Panel>
      <PanelSection title="Queue Overview">
        <InfoRow label="Expired F2F" value={referrals.filter((r) => r.f2f_urgency === 'Expired').length} highlight={palette.primaryMagenta.hex} />
        <InfoRow label="Expiring <7d" value={referrals.filter((r) => r.f2f_urgency === 'Red').length} highlight={palette.primaryMagenta.hex} />
        <InfoRow label="Expiring <14d" value={referrals.filter((r) => r.f2f_urgency === 'Orange').length} highlight={palette.accentOrange.hex} />
        <InfoRow label="No F2F yet" value={referrals.filter((r) => !r.f2f_date).length} />
      </PanelSection>

      {ref && (
        <>
          <PanelSection title="F2F Status">
            {days !== null ? (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <p style={{ fontSize: 36, fontWeight: 800, color: urgencyColor, lineHeight: 1 }}>{days < 0 ? 'EXPIRED' : `${days}d`}</p>
                <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 4 }}>{days < 0 ? 'F2F has expired' : 'until F2F expiration'}</p>
              </div>
            ) : (
              <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), textAlign: 'center', padding: '12px 0' }}>No F2F date recorded</p>
            )}
            <InfoRow label="PECOS Verified" value={ref.is_pecos_verified === 'TRUE' || ref.is_pecos_verified === true ? 'Yes' : 'No'} highlight={ref.is_pecos_verified === 'TRUE' || ref.is_pecos_verified === true ? palette.accentGreen.hex : palette.primaryMagenta.hex} />
            <InfoRow label="OPRA Verified" value={ref.is_opra_verified === 'TRUE' || ref.is_opra_verified === true ? 'Yes' : 'No'} />
          </PanelSection>
          <PanelSection title="Actions">
            <ActionBtn label="Upload F2F Document" variant="primary" />
            <ActionBtn label="Move to Clinical RN" variant="success" />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 6. Clinical Intake RN Review ──────────────────────────────────────────────
function ClinicalRNPanel({ selectedReferral }) {
  const [assessment, setAssessment] = useState({ skilled_need: false, safe_environment: false, services_available: false, icd10_reviewed: false });
  const toggle = (k) => setAssessment((p) => ({ ...p, [k]: !p[k] }));
  const allDone = Object.values(assessment).every(Boolean);

  return (
    <Panel>
      <PanelSection title="Clinical Assessment">
        {Object.entries(assessment).map(([k, v]) => (
          <CheckItem key={k} label={k.replace(/_/g, ' ')} done={v} onChange={() => toggle(k)} />
        ))}
      </PanelSection>
      <PanelSection title="Protected Actions">
        <div style={{ padding: '8px 10px', borderRadius: 7, background: hexToRgba(palette.accentOrange.hex, 0.08), border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.25)}`, marginBottom: 10, fontSize: 11.5, color: '#8B4A00', lineHeight: 1.5 }}>
          Moving out of this stage requires DevNurse scope and confirmation.
        </div>
        <ActionBtn label={allDone ? 'Approve → Auth / Staffing' : 'Complete assessment first'} variant={allDone ? 'success' : 'default'} />
        <ActionBtn label="Place on Hold" variant="warning" />
        <ActionBtn label="Mark NTUC" variant="danger" />
      </PanelSection>
      <PanelSection title="Tools">
        <ActionBtn label="ICD-10 Lookup" variant="primary" />
        <ActionBtn label="Open Triage Form" />
        <ActionBtn label="View F2F / MD Orders" />
      </PanelSection>
    </Panel>
  );
}

// ── 7. Authorization Pending ──────────────────────────────────────────────────
function AuthorizationPanel({ selectedReferral }) {
  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Auth Details">
            <InfoRow label="Plan" value={selectedReferral.patient?.insurance_plan} />
            <InfoRow label="Submitted" value="—" />
            <InfoRow label="Expected response" value="—" />
          </PanelSection>
          <PanelSection title="Actions">
            <ActionBtn label="Record Approval" variant="success" />
            <ActionBtn label="Record Denial" variant="danger" />
            <ActionBtn label="Follow Up" />
            <ActionBtn label="Place on Hold" variant="warning" />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 8. Conflict ───────────────────────────────────────────────────────────────
function ConflictPanel({ selectedReferral }) {
  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Resolution Actions">
            <ActionBtn label="Resolve Conflict" variant="success" />
            <ActionBtn label="Escalate" variant="warning" />
            <ActionBtn label="Mark NTUC" variant="danger" />
          </PanelSection>
          <PanelSection title="Related Data">
            <ActionBtn label="View Eligibility Check" />
            <ActionBtn label="View Related Documents" />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 9. Staffing Feasibility ───────────────────────────────────────────────────
function StaffingPanel({ selectedReferral }) {
  const [contacted, setContacted] = useState(false);
  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Required Before Advancing">
            <label style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', borderRadius: 8, background: contacted ? hexToRgba(palette.accentGreen.hex, 0.08) : hexToRgba(palette.primaryMagenta.hex, 0.05), border: `1px solid ${contacted ? hexToRgba(palette.accentGreen.hex, 0.3) : hexToRgba(palette.primaryMagenta.hex, 0.2)}`, cursor: 'pointer' }}>
              <input type="checkbox" checked={contacted} onChange={(e) => setContacted(e.target.checked)} style={{ accentColor: palette.primaryMagenta.hex, width: 16, height: 16 }} />
              <div>
                <p style={{ fontSize: 12.5, fontWeight: 650, color: palette.backgroundDark.hex }}>Patient / parent contacted</p>
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>Required before moving to Admin Confirmation</p>
              </div>
            </label>
          </PanelSection>
          <PanelSection title="Case Info">
            <InfoRow label="Services needed" value={Array.isArray(selectedReferral.services_requested) ? selectedReferral.services_requested.join(', ') : '—'} />
            <InfoRow label="Division" value={selectedReferral.division} />
            <InfoRow label="Zip code" value={selectedReferral.patient?.address_zip} />
          </PanelSection>
          <PanelSection title="Actions">
            <ActionBtn label={contacted ? 'Move to Admin Confirmation' : 'Contact patient first'} variant={contacted ? 'success' : 'default'} />
            <ActionBtn label="Place on Hold" variant="warning" />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 10. Admin Confirmation ────────────────────────────────────────────────────
function AdminConfirmationPanel({ selectedReferral }) {
  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Case Summary">
            <InfoRow label="Patient" value={selectedReferral.patientName} />
            <InfoRow label="Division" value={selectedReferral.division} />
            <InfoRow label="Services" value={Array.isArray(selectedReferral.services_requested) ? selectedReferral.services_requested.join(', ') : '—'} />
            <InfoRow label="Insurance" value={selectedReferral.patient?.insurance_plan} />
            <InfoRow label="Days in pipeline" value={Math.floor((Date.now() - new Date(selectedReferral.referral_date).getTime()) / 86400000) + 'd'} />
          </PanelSection>
          <PanelSection title="Decision">
            <div style={{ padding: '8px 10px', borderRadius: 7, background: hexToRgba(palette.accentOrange.hex, 0.08), border: `1px solid ${hexToRgba(palette.accentOrange.hex, 0.25)}`, marginBottom: 10, fontSize: 11.5, color: '#8B4A00' }}>
              Accept / Decline is a protected action — requires Admin scope.
            </div>
            <ActionBtn label="Accept → Pre-SOC" variant="success" />
            <ActionBtn label="Decline → NTUC" variant="danger" />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 11. Pre-SOC ───────────────────────────────────────────────────────────────
function PreSocPanel({ selectedReferral }) {
  const [docs, setDocs] = useState({ f2f_docs: false, md_orders: false, auth_letter: false, insurance_card: false, consent_signed: false });
  const toggle = (k) => setDocs((p) => ({ ...p, [k]: !p[k] }));
  const allDone = Object.values(docs).every(Boolean);
  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="Documentation Checklist">
            {Object.entries(docs).map(([k, v]) => (
              <CheckItem key={k} label={k.replace(/_/g, ' ')} done={v} onChange={() => toggle(k)} />
            ))}
          </PanelSection>
          <PanelSection title="Actions">
            <ActionBtn label={allDone ? 'Schedule SOC' : 'Complete docs first'} variant={allDone ? 'primary' : 'default'} />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 12. SOC Scheduled ─────────────────────────────────────────────────────────
function SocScheduledPanel({ selectedReferral }) {
  return (
    <Panel>
      {!selectedReferral ? <EmptyPanelState /> : (
        <>
          <PanelSection title="SOC Details">
            <InfoRow label="Scheduled date" value={selectedReferral.soc_scheduled_date ? new Date(selectedReferral.soc_scheduled_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'} />
            <InfoRow label="Clinician" value="—" />
          </PanelSection>
          <PanelSection title="Actions">
            <ActionBtn label="Mark SOC Completed" variant="success" />
            <ActionBtn label="Reschedule / Hold" variant="warning" />
          </PanelSection>
        </>
      )}
    </Panel>
  );
}

// ── 13. SOC Completed ─────────────────────────────────────────────────────────
function SocCompletedPanel({ referrals }) {
  const hchbDone = referrals.filter((r) => r.hchb_entered === true || r.hchb_entered === 'true').length;
  return (
    <Panel>
      <PanelSection title="HCHB Entry Status">
        <InfoRow label="Entered in HCHB" value={hchbDone} highlight={palette.accentGreen.hex} />
        <InfoRow label="Pending HCHB entry" value={referrals.length - hchbDone} highlight={referrals.length - hchbDone > 0 ? palette.accentOrange.hex : null} />
      </PanelSection>
      <PanelSection title="Notes">
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.6 }}>
          This is a terminal stage. No forward transitions are available. Cases should be fully entered in HCHB.
        </p>
      </PanelSection>
    </Panel>
  );
}

// ── 14. Hold ──────────────────────────────────────────────────────────────────
function HoldPanel({ referrals, selectedReferral }) {
  const overdue = referrals.filter((r) => {
    if (!r.hold_expected_resolution) return false;
    return new Date(r.hold_expected_resolution) < new Date();
  }).length;

  return (
    <Panel>
      <PanelSection title="Hold Summary">
        <InfoRow label="Overdue resolutions" value={overdue} highlight={overdue > 0 ? palette.primaryMagenta.hex : null} />
        <InfoRow label="Total on hold" value={referrals.length} />
      </PanelSection>

      {selectedReferral && (
        <PanelSection title="Hold Details">
          <InfoRow label="Hold reason" value={selectedReferral.hold_reason} />
          <InfoRow label="Return to stage" value={selectedReferral.hold_return_stage} />
          <InfoRow label="Expected resolution" value={selectedReferral.hold_expected_resolution ? new Date(selectedReferral.hold_expected_resolution).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'} />
          <div style={{ marginTop: 10 }}>
            <ActionBtn label="Release Hold → Return to Stage" variant="success" />
            <ActionBtn label="Move to NTUC" variant="danger" />
          </div>
        </PanelSection>
      )}
    </Panel>
  );
}

// ── 15. NTUC ──────────────────────────────────────────────────────────────────
function NtucPanel({ referrals }) {
  const reasons = {};
  referrals.forEach((r) => {
    const k = r.ntuc_reason || 'Unspecified';
    reasons[k] = (reasons[k] || 0) + 1;
  });

  return (
    <Panel>
      <PanelSection title="NTUC Breakdown">
        {Object.entries(reasons).sort(([, a], [, b]) => b - a).map(([reason, count]) => (
          <InfoRow key={reason} label={reason} value={count} />
        ))}
      </PanelSection>
      <PanelSection title="Actions">
        <ActionBtn label="Export NTUC Report" variant="primary" />
      </PanelSection>
      <PanelSection title="Notes">
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.6 }}>
          Terminal state. No forward transitions available. NTUC records are preserved for reporting and attribution.
        </p>
      </PanelSection>
    </Panel>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
export default function StagePanel({ stage, referrals, selectedReferral, resolveUser, resolveSource }) {
  const props = { referrals, selectedReferral, resolveUser, resolveSource };
  switch (stage) {
    case 'Lead Entry':                return <LeadEntryPanel {...props} />;
    case 'Intake':                    return <IntakePanel {...props} />;
    case 'Eligibility Verification':  return <EligibilityPanel {...props} />;
    case 'Disenrollment Required':    return <DisenrollmentPanel {...props} />;
    case 'F2F/MD Orders Pending':     return <F2FPanel {...props} />;
    case 'Clinical Intake RN Review': return <ClinicalRNPanel {...props} />;
    case 'Authorization Pending':     return <AuthorizationPanel {...props} />;
    case 'Conflict':                  return <ConflictPanel {...props} />;
    case 'Staffing Feasibility':      return <StaffingPanel {...props} />;
    case 'Admin Confirmation':        return <AdminConfirmationPanel {...props} />;
    case 'Pre-SOC':                   return <PreSocPanel {...props} />;
    case 'SOC Scheduled':             return <SocScheduledPanel {...props} />;
    case 'SOC Completed':             return <SocCompletedPanel {...props} />;
    case 'Hold':                      return <HoldPanel {...props} />;
    case 'NTUC':                      return <NtucPanel {...props} />;
    default: return null;
  }
}
