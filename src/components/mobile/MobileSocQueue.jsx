import palette, { hexToRgba } from '../../utils/colors.js';
import { fmtCalendarDate } from '../../utils/dateFormat.js';
import { isDocumentationDeferred } from '../../utils/documentationDeferred.js';
import { getUrgentCareType, urgentCareTypeLabel } from '../../utils/urgentCare.js';
import DivisionBadge from '../common/DivisionBadge.jsx';
import StageBadge from '../common/StageBadge.jsx';

/**
 * Mobile-native SOC Completed / Pending Log queue.
 * Card list with thumb-friendly actions — not a shrunk desktop table.
 */
export default function MobileSocQueue({
  meta,
  stageColor,
  referrals,
  search,
  setSearch,
  isPendingLogView,
  canPendingLog,
  onTogglePendingLog,
  onOpenPatient,
  onOpenFiles,
  onOpenNotes,
  resolveFacility,
  resolveMarketer,
  resolveUser,
  resolvePhysician,
  pcpByReferralId,
}) {
  return (
    <div style={{
      minHeight: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: hexToRgba(palette.backgroundDark.hex, 0.02),
    }}>
      {/* Hero header */}
      <div style={{
        padding: '16px 16px 14px',
        background: palette.backgroundLight.hex,
        borderBottom: `1px solid var(--color-border)`,
        borderTop: `3px solid ${stageColor || palette.accentGreen.hex}`,
        position: 'sticky',
        top: 0,
        zIndex: 5,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <h1 style={{ fontSize: 20, fontWeight: 750, color: palette.backgroundDark.hex, margin: 0 }}>
                {isPendingLogView ? 'Pending Log' : (meta?.displayName || 'Completed')}
              </h1>
              <span style={{
                fontSize: 12, fontWeight: 750, padding: '2px 9px', borderRadius: 10,
                background: hexToRgba(stageColor || palette.accentGreen.hex, 0.14),
                color: stageColor || palette.accentGreen.hex,
              }}>
                {referrals.length}
              </span>
            </div>
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: 0, lineHeight: 1.4 }}>
              {isPendingLogView
                ? 'Facility, docs wait, and account-manager follow-ups'
                : 'Start of care completed — tap a patient for files or notes'}
            </p>
          </div>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: hexToRgba(palette.backgroundDark.hex, 0.04),
          border: `1px solid var(--color-border)`,
          borderRadius: 10, padding: '0 12px', height: 42, marginBottom: canPendingLog ? 10 : 0,
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" />
            <path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patients…"
            style={{
              background: 'none', border: 'none', outline: 'none', flex: 1,
              fontSize: 15, color: palette.backgroundDark.hex, fontFamily: 'inherit',
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              style={{
                background: hexToRgba(palette.backgroundDark.hex, 0.08), border: 'none',
                borderRadius: 6, width: 24, height: 24, cursor: 'pointer',
                color: hexToRgba(palette.backgroundDark.hex, 0.5), fontSize: 14, fontWeight: 800,
              }}
            >
              ×
            </button>
          )}
        </div>

        {canPendingLog && (
          <div style={{
            display: 'flex', padding: 3, borderRadius: 10,
            background: hexToRgba(palette.backgroundDark.hex, 0.06), gap: 3,
          }}>
            {[
              { id: 'standard', label: 'Completed' },
              { id: 'pending_log', label: 'Pending Log' },
            ].map((tab) => {
              const active = isPendingLogView ? tab.id === 'pending_log' : tab.id === 'standard';
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (active) return;
                    onTogglePendingLog?.();
                  }}
                  style={{
                    flex: 1, height: 34, borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                    background: active ? palette.backgroundLight.hex : 'transparent',
                    color: active ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
                    boxShadow: active ? `0 1px 3px ${hexToRgba(palette.backgroundDark.hex, 0.1)}` : 'none',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Cards */}
      <div style={{ padding: '12px 12px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {referrals.length === 0 ? (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            background: palette.backgroundLight.hex, borderRadius: 14,
            border: `1px solid var(--color-border)`,
          }}>
            <p style={{ fontSize: 14, fontWeight: 650, color: palette.backgroundDark.hex, margin: 0 }}>
              {search ? 'No matches' : 'No completed SOCs yet'}
            </p>
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: '6px 0 0' }}>
              {search ? 'Try a different name.' : 'Patients appear here once SOC is confirmed.'}
            </p>
          </div>
        ) : (
          referrals.map((ref) => (
            <SocCard
              key={ref._id}
              referral={ref}
              pendingLog={isPendingLogView}
              onOpen={() => onOpenPatient?.(ref)}
              onFiles={() => onOpenFiles?.(ref)}
              onNotes={() => onOpenNotes?.(ref)}
              resolveFacility={resolveFacility}
              resolveMarketer={resolveMarketer}
              resolveUser={resolveUser}
              resolvePhysician={resolvePhysician}
              pcpByReferralId={pcpByReferralId}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SocCard({
  referral,
  pendingLog,
  onOpen,
  onFiles,
  onNotes,
  resolveFacility,
  resolveMarketer,
  resolveUser,
  resolvePhysician,
  pcpByReferralId,
}) {
  const name = referral.patientName || referral.patient_id || '—';
  const facility = referral.facility_id ? resolveFacility?.(referral.facility_id) : null;
  const marketer = referral.marketer_id ? resolveMarketer?.(referral.marketer_id) : null;
  const waitingDocs = isDocumentationDeferred(referral);
  const urgentType = getUrgentCareType(referral);
  const urgentLabel = urgentCareTypeLabel(urgentType);
  const amInfo = String(referral.account_manager_info || '').trim();
  const clinicalNote = String(referral.returned_from_clinical_note || '').trim();
  const notePreview = (amInfo || clinicalNote).slice(0, 120);
  const pcpId = pcpByReferralId?.[referral.id] || referral.physician_id;
  const pcp = pcpId ? resolvePhysician?.(pcpId) : null;
  const rn = resolveUser?.(referral.clinical_review_completed_by_id || referral.clinical_review_by);
  const workStage = referral.current_stage && referral.current_stage !== 'SOC Completed'
    ? referral.current_stage
    : null;

  return (
    <article
      style={{
        background: palette.backgroundLight.hex,
        borderRadius: 14,
        border: `1px solid var(--color-border)`,
        boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}`,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        style={{
          display: 'block', width: '100%', textAlign: 'left', border: 'none',
          background: 'transparent', padding: '14px 14px 10px', cursor: 'pointer',
          fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0, lineHeight: 1.25 }}>
              {name}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7, alignItems: 'center' }}>
              <DivisionBadge division={referral.division} size="small" />
              {referral.soc_completed_date && (
                <span style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), fontWeight: 550 }}>
                  SOC {fmtCalendarDate(referral.soc_completed_date)}
                </span>
              )}
              {workStage && (
                <span style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: '0.03em',
                  color: palette.accentBlue.hex,
                  background: hexToRgba(palette.accentBlue.hex, 0.12),
                  borderRadius: 4, padding: '2px 6px',
                }}>
                  also {workStage === 'Intake' ? 'Intake' : workStage}
                </span>
              )}
            </div>
          </div>
          {urgentLabel && (
            <span style={{
              flexShrink: 0, fontSize: 10, fontWeight: 800, letterSpacing: '0.04em',
              color: palette.primaryMagenta.hex,
              background: hexToRgba(palette.primaryMagenta.hex, 0.1),
              border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.25)}`,
              borderRadius: 6, padding: '3px 7px',
            }}>
              {urgentLabel.toUpperCase()}
            </span>
          )}
        </div>

        {pendingLog ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {facility && facility !== '—' && (
              <MetaRow label="Facility" value={facility} />
            )}
            {referral.insurance_plan && (
              <MetaRow label="Insurance" value={referral.insurance_plan} />
            )}
            {pcp && pcp !== '—' && <MetaRow label="PCP" value={pcp} />}
            {marketer && marketer !== '—' && <MetaRow label="Marketer" value={marketer} />}
            {rn && rn !== '—' && <MetaRow label="Clinical RN" value={rn} />}
            {waitingDocs && (
              <span style={{
                alignSelf: 'flex-start', marginTop: 4,
                fontSize: 11, fontWeight: 750, color: palette.accentOrange.hex,
                background: hexToRgba(palette.accentOrange.hex, 0.12),
                borderRadius: 6, padding: '3px 8px',
              }}>
                Waiting for docs
              </span>
            )}
            {notePreview && (
              <p style={{
                fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6),
                margin: '6px 0 0', lineHeight: 1.4,
                display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
              }}>
                {notePreview}{(amInfo || clinicalNote).length > 120 ? '…' : ''}
              </p>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {facility && facility !== '—' && (
              <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>{facility}</span>
            )}
            {marketer && marketer !== '—' && (
              <span style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>· {marketer}</span>
            )}
            {!workStage && <StageBadge stage="SOC Completed" size="small" />}
          </div>
        )}
      </button>

      <div style={{
        display: 'flex', borderTop: `1px solid var(--color-border)`,
        background: hexToRgba(palette.backgroundDark.hex, 0.015),
      }}>
        <ActionBtn label="Open" onClick={onOpen} primary />
        <ActionBtn label="Files" onClick={onFiles} />
        <ActionBtn label="Notes" onClick={onNotes} last />
      </div>
    </article>
  );
}

function MetaRow({ label, value }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.35 }}>
      <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.4), fontWeight: 600, flexShrink: 0, minWidth: 72 }}>{label}</span>
      <span style={{ color: palette.backgroundDark.hex, fontWeight: 550 }}>{value}</span>
    </div>
  );
}

function ActionBtn({ label, onClick, primary, last }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      style={{
        flex: 1, height: 44, border: 'none',
        borderRight: last ? 'none' : `1px solid var(--color-border)`,
        background: 'transparent', cursor: 'pointer',
        fontSize: 13, fontWeight: primary ? 750 : 650, fontFamily: 'inherit',
        color: primary ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.65),
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}
    </button>
  );
}
