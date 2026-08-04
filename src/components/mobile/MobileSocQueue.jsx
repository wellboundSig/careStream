import { useMemo, useState } from 'react';
import palette, { hexToRgba } from '../../utils/colors.js';
import { fmtCalendarDate } from '../../utils/dateFormat.js';
import { isDocumentationDeferred } from '../../utils/documentationDeferred.js';
import { getUrgentCareType, isUrgentCare, urgentCareTypeLabel } from '../../utils/urgentCare.js';
import DivisionBadge from '../common/DivisionBadge.jsx';
import StageBadge from '../common/StageBadge.jsx';
import EpisodeTypeBadge from '../common/EpisodeTypeBadge.jsx';
import { normalizeEpisodeType, episodeTypeLabel } from '../../utils/episodeType.js';

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
  isSocCompleted = false,
  onTogglePendingLog,
  onOpenPatient,
  onOpenFiles,
  onOpenNotes,
  onOpenConflicts,
  resolveFacility,
  resolveMarketer,
  resolveUser,
  resolvePhysician,
  pcpByReferralId,
}) {
  // SOC Completed mobile: default to “needs docs” so marketers see follow-ups first.
  const showNeedsDocsToggle = !!isSocCompleted || !!(canPendingLog || isPendingLogView);
  const [needsDocsOnly, setNeedsDocsOnly] = useState(true);
  const [episodeFilter, setEpisodeFilter] = useState('ALL'); // ALL | SOC | ROC
  const [facilityFilter, setFacilityFilter] = useState(null); // null = all, or facility_id / '__none__'
  const [filtersOpen, setFiltersOpen] = useState(true);

  const waitingDocsCount = useMemo(
    () => (referrals || []).filter((r) => isDocumentationDeferred(r)).length,
    [referrals],
  );

  const facilityOptions = useMemo(() => {
    const map = new Map();
    for (const r of referrals || []) {
      const id = r.facility_id || '__none__';
      const name = id === '__none__'
        ? 'No facility'
        : (resolveFacility?.(id) || String(id));
      if (name === '—') continue;
      const prev = map.get(id);
      if (prev) prev.count += 1;
      else map.set(id, { id, name, count: 1 });
    }
    return [...map.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
  }, [referrals, resolveFacility]);

  const activeFacility = facilityFilter
    ? facilityOptions.find((f) => f.id === facilityFilter) || null
    : null;

  const visibleReferrals = useMemo(() => {
    let list = referrals || [];
    if (episodeFilter === 'SOC' || episodeFilter === 'ROC') {
      list = list.filter((r) => normalizeEpisodeType(r) === episodeFilter);
    }
    if (facilityFilter === '__none__') {
      list = list.filter((r) => !r.facility_id);
    } else if (facilityFilter) {
      list = list.filter((r) => r.facility_id === facilityFilter);
    }
    if (showNeedsDocsToggle && needsDocsOnly) {
      list = list.filter((r) => isDocumentationDeferred(r));
    }
    return list;
  }, [referrals, showNeedsDocsToggle, needsDocsOnly, episodeFilter, facilityFilter]);

  const activeFilterCount = [
    episodeFilter !== 'ALL',
    !!facilityFilter,
    showNeedsDocsToggle && needsDocsOnly,
    !!search?.trim(),
  ].filter(Boolean).length;

  return (
    <div style={{
      minHeight: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: hexToRgba(palette.backgroundDark.hex, 0.02),
    }}>
      {/* Sticky header */}
      <div style={{
        padding: filtersOpen ? '14px 16px 12px' : '10px 16px 10px',
        background: palette.backgroundLight.hex,
        borderBottom: `1px solid var(--color-border)`,
        borderTop: `3px solid ${stageColor || palette.accentGreen.hex}`,
        position: 'sticky',
        top: 0,
        zIndex: 5,
      }}>
        {/* Title row — always visible */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
            <h1 style={{
              fontSize: filtersOpen ? 20 : 17, fontWeight: 750,
              color: palette.backgroundDark.hex, margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {isPendingLogView ? 'Pending Log' : (meta?.displayName || 'Completed')}
            </h1>
            <span style={{
              fontSize: 12, fontWeight: 750, padding: '2px 9px', borderRadius: 10, flexShrink: 0,
              background: hexToRgba(stageColor || palette.accentGreen.hex, 0.14),
              color: stageColor || palette.accentGreen.hex,
            }}>
              {visibleReferrals.length}
              {(referrals?.length || 0) !== visibleReferrals.length
                ? ` / ${referrals.length}`
                : ''}
            </span>
          </div>
          <button
            type="button"
            data-testid="mobile-filters-toggle"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((v) => !v)}
            style={{
              flexShrink: 0,
              height: 34,
              padding: '0 10px',
              borderRadius: 8,
              border: `1px solid ${filtersOpen ? hexToRgba(palette.primaryDeepPlum.hex, 0.25) : 'var(--color-border)'}`,
              background: filtersOpen
                ? hexToRgba(palette.primaryDeepPlum.hex, 0.08)
                : hexToRgba(palette.backgroundDark.hex, 0.03),
              color: filtersOpen ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.55),
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'inherit',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {filtersOpen ? 'Hide' : 'Filters'}
            {!filtersOpen && activeFilterCount > 0 && (
              <span style={{
                minWidth: 16, height: 16, borderRadius: 8, padding: '0 4px',
                background: palette.primaryMagenta.hex, color: '#fff',
                fontSize: 10, fontWeight: 800,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {activeFilterCount}
              </span>
            )}
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden style={{
              transform: filtersOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s',
            }}>
              <path d="M2 4.5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Collapsed summary — active facility + quick clear */}
        {!filtersOpen && activeFacility && (
          <button
            type="button"
            onClick={() => setFacilityFilter(null)}
            style={{
              marginTop: 8, width: '100%', textAlign: 'left',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: hexToRgba(palette.accentBlue.hex, 0.1),
              fontFamily: 'inherit', WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 650, color: palette.accentBlue.hex, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeFacility.name}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: palette.accentBlue.hex, flexShrink: 0 }}>Clear</span>
          </button>
        )}

        {/* Facility chips — always available (collapsed or open) */}
        {facilityOptions.length > 0 && (
          <div style={{ marginTop: filtersOpen ? 12 : 8 }}>
            {filtersOpen && (
              <p style={{
                margin: '0 0 6px', fontSize: 10.5, fontWeight: 700,
                letterSpacing: '0.05em', textTransform: 'uppercase',
                color: hexToRgba(palette.backgroundDark.hex, 0.4),
              }}>
                Facility
              </p>
            )}
            <div
              data-testid="mobile-facility-filter"
              style={{
                display: 'flex', gap: 6, overflowX: 'auto',
                WebkitOverflowScrolling: 'touch',
                paddingBottom: 2, marginRight: -16, paddingRight: 16,
                scrollbarWidth: 'none',
              }}
            >
              <FacilityChip
                label="All"
                count={referrals?.length || 0}
                active={!facilityFilter}
                onClick={() => setFacilityFilter(null)}
              />
              {facilityOptions.map((f) => (
                <FacilityChip
                  key={f.id}
                  label={f.name}
                  count={f.count}
                  active={facilityFilter === f.id}
                  onClick={() => setFacilityFilter((prev) => (prev === f.id ? null : f.id))}
                />
              ))}
            </div>
          </div>
        )}

        {/* Expandable filter details */}
        {filtersOpen && (
          <>
            <p style={{
              fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45),
              margin: '10px 0 0', lineHeight: 1.4,
            }}>
              {isPendingLogView
                ? 'Tap a facility chip to see only that building.'
                : canPendingLog
                  ? 'Completed care — filter by facility when you are on site.'
                  : (meta?.description || 'Tap a patient for files, notes, or conflicts')}
            </p>

            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {['ALL', 'SOC', 'ROC'].map((key) => {
                const active = episodeFilter === key;
                const label = key === 'ALL' ? 'All' : key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setEpisodeFilter(key)}
                    style={{
                      flex: 1,
                      height: 32,
                      borderRadius: 8,
                      border: active
                        ? `1.5px solid ${key === 'ROC' ? palette.accentBlue.hex : palette.accentGreen.hex}`
                        : '1px solid var(--color-border)',
                      background: active
                        ? hexToRgba(key === 'ROC' ? palette.accentBlue.hex : palette.accentGreen.hex, 0.12)
                        : palette.backgroundLight.hex,
                      color: active
                        ? (key === 'ROC' ? palette.accentBlue.hex : palette.accentGreen.hex)
                        : hexToRgba(palette.backgroundDark.hex, 0.55),
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {showNeedsDocsToggle && (
              <button
                type="button"
                role="switch"
                aria-checked={needsDocsOnly}
                onClick={() => setNeedsDocsOnly((v) => !v)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  marginTop: 10,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: needsDocsOnly
                    ? `1.5px solid ${hexToRgba(palette.accentOrange.hex, 0.45)}`
                    : `1px solid var(--color-border)`,
                  background: needsDocsOnly
                    ? hexToRgba(palette.accentOrange.hex, 0.1)
                    : hexToRgba(palette.backgroundDark.hex, 0.03),
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  WebkitTapHighlightColor: 'transparent',
                  textAlign: 'left',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{
                    margin: 0, fontSize: 13.5, fontWeight: 750,
                    color: needsDocsOnly ? palette.accentOrange.hex : palette.backgroundDark.hex,
                  }}>
                    Needs docs only
                  </p>
                  <p style={{
                    margin: '2px 0 0', fontSize: 11.5,
                    color: hexToRgba(palette.backgroundDark.hex, 0.45),
                  }}>
                    {waitingDocsCount} waiting
                    {!needsDocsOnly ? ' · showing everyone' : ''}
                  </p>
                </div>
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: 44,
                    height: 26,
                    borderRadius: 13,
                    padding: 2,
                    background: needsDocsOnly
                      ? palette.accentOrange.hex
                      : hexToRgba(palette.backgroundDark.hex, 0.18),
                    transition: 'background 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: needsDocsOnly ? 'flex-end' : 'flex-start',
                  }}
                >
                  <span style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    background: palette.backgroundLight.hex,
                    boxShadow: `0 1px 3px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
                  }} />
                </span>
              </button>
            )}

            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginTop: 10,
              background: hexToRgba(palette.backgroundDark.hex, 0.04),
              border: `1px solid var(--color-border)`,
              borderRadius: 10, padding: '0 12px', height: 42,
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
                display: 'flex', padding: 3, borderRadius: 10, marginTop: 10,
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
          </>
        )}
      </div>

      {/* Cards */}
      <div style={{ padding: '12px 12px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visibleReferrals.length === 0 ? (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            background: palette.backgroundLight.hex, borderRadius: 14,
            border: `1px solid var(--color-border)`,
          }}>
            <p style={{ fontSize: 14, fontWeight: 650, color: palette.backgroundDark.hex, margin: 0 }}>
              {search
                ? 'No matches'
                : facilityFilter
                  ? 'No patients at this facility'
                  : showNeedsDocsToggle && needsDocsOnly
                    ? 'No one waiting on docs'
                    : (canPendingLog || isPendingLogView)
                      ? 'No completed SOCs yet'
                      : `No patients in ${meta?.displayName || 'this queue'}`}
            </p>
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: '6px 0 0' }}>
              {search
                ? 'Try a different name.'
                : facilityFilter
                  ? 'Tap All or another facility chip.'
                  : showNeedsDocsToggle && needsDocsOnly
                    ? 'Turn off “Needs docs only” to see everyone.'
                    : (canPendingLog || isPendingLogView)
                      ? 'Patients appear here once SOC is confirmed.'
                      : 'They’ll show up when routed here.'}
            </p>
          </div>
        ) : (
          visibleReferrals.map((ref) => (
            <SocCard
              key={ref._id}
              referral={ref}
              pendingLog={isPendingLogView}
              onOpen={() => onOpenPatient?.(ref)}
              onFiles={() => onOpenFiles?.(ref)}
              onNotes={() => onOpenNotes?.(ref)}
              onConflicts={() => onOpenConflicts?.(ref)}
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

function FacilityChip({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0,
        height: 34,
        padding: '0 12px',
        borderRadius: 17,
        border: active
          ? `1.5px solid ${palette.accentBlue.hex}`
          : '1px solid var(--color-border)',
        background: active
          ? hexToRgba(palette.accentBlue.hex, 0.12)
          : palette.backgroundLight.hex,
        color: active ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.65),
        fontSize: 12.5,
        fontWeight: 700,
        fontFamily: 'inherit',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: 220,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span style={{
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      <span style={{
        fontSize: 11, fontWeight: 750, flexShrink: 0,
        opacity: active ? 1 : 0.65,
      }}>
        {count}
      </span>
    </button>
  );
}

function SocCard({
  referral,
  pendingLog,
  onOpen,
  onFiles,
  onNotes,
  onConflicts,
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
  const urgent = isUrgentCare(referral);
  const urgentType = getUrgentCareType(referral);
  const urgentLabel = urgentCareTypeLabel(urgentType);
  const amInfo = String(referral.account_manager_info || '').trim();
  const clinicalNote = String(referral.returned_from_clinical_note || '').trim();
  const noteParts = [];
  if (clinicalNote) noteParts.push(clinicalNote);
  if (amInfo) noteParts.push(amInfo);
  const noteFull = noteParts.join('\n\n');
  const notePreview = noteFull.slice(0, 160);
  const pcpId = pcpByReferralId?.[referral.id] || referral.physician_id;
  const pcp = pcpId ? resolvePhysician?.(pcpId) : null;
  const rn = resolveUser?.(referral.clinical_review_completed_by_id || referral.clinical_review_by);
  const workStage = referral.current_stage && referral.current_stage !== 'SOC Completed'
    ? referral.current_stage
    : null;
  const ep = episodeTypeLabel(referral);
  const socDate = referral.soc_completed_date
    ? (fmtCalendarDate(referral.soc_completed_date) || String(referral.soc_completed_date).slice(0, 10))
    : null;
  const addedRaw = referral._stage_entered_at || referral.soc_completed_date || null;
  const addedDate = addedRaw
    ? (fmtCalendarDate(addedRaw) || String(addedRaw).slice(0, 10))
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
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0, lineHeight: 1.25 }}>
              {name}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7, alignItems: 'center' }}>
              <DivisionBadge division={referral.division} size="small" />
              <EpisodeTypeBadge referral={referral} size="tiny" />
              {socDate && (
                <Chip strong color={palette.accentGreen.hex}>
                  {ep} {socDate}
                </Chip>
              )}
              {!socDate && addedDate && (
                <Chip>Added {addedDate}</Chip>
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
          {(urgent || urgentLabel) && (
            <span style={{
              flexShrink: 0, fontSize: 10, fontWeight: 800, letterSpacing: '0.04em',
              color: palette.primaryMagenta.hex,
              background: hexToRgba(palette.primaryMagenta.hex, 0.1),
              border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.25)}`,
              borderRadius: 6, padding: '3px 7px', textAlign: 'center', lineHeight: 1.25,
            }}>
              {urgentLabel ? urgentLabel.toUpperCase() : 'URGENT'}
            </span>
          )}
        </div>

        {(socDate || urgent || pendingLog) && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8,
            padding: '8px 10px', borderRadius: 8,
            background: hexToRgba(palette.backgroundDark.hex, 0.03),
          }}>
            {(socDate || pendingLog) && (
              <DateStat label={`${ep} completed`} value={socDate || '—'} emphasize={!!socDate} />
            )}
            {pendingLog && (
              <DateStat label="Added to module" value={addedDate || '—'} />
            )}
            {urgent && (
              <DateStat
                label="Urgent type"
                value={urgentLabel || 'Flagged'}
                emphasize
                danger
              />
            )}
          </div>
        )}

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
          {!pendingLog && !workStage && (
            <div style={{ marginTop: 2 }}>
              <StageBadge stage="SOC Completed" size="small" />
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {waitingDocs && (
              <span style={{
                fontSize: 11, fontWeight: 750, color: palette.accentOrange.hex,
                background: hexToRgba(palette.accentOrange.hex, 0.12),
                borderRadius: 6, padding: '3px 8px',
              }}>
                Waiting for docs
              </span>
            )}
            {urgent && !urgentLabel && (
              <span style={{
                fontSize: 11, fontWeight: 750, color: palette.primaryMagenta.hex,
                background: hexToRgba(palette.primaryMagenta.hex, 0.1),
                borderRadius: 6, padding: '3px 8px',
              }}>
                Urgent care
              </span>
            )}
          </div>
          {notePreview && (
            <p style={{
              fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.6),
              margin: '6px 0 0', lineHeight: 1.4, whiteSpace: 'pre-wrap',
              display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {notePreview}{noteFull.length > 160 ? '…' : ''}
            </p>
          )}
        </div>
      </button>

      <div style={{
        display: 'flex', borderTop: `1px solid var(--color-border)`,
        background: hexToRgba(palette.backgroundDark.hex, 0.015),
      }}>
        <ActionBtn label="Open" onClick={onOpen} primary />
        <ActionBtn label="Files" onClick={onFiles} />
        <ActionBtn label="Notes" onClick={onNotes} />
        <ActionBtn label="Conflicts" onClick={onConflicts || onOpen} last />
      </div>
    </article>
  );
}

function DateStat({ label, value, emphasize, danger }) {
  return (
    <div style={{ minWidth: '30%', flex: '1 1 30%' }}>
      <p style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
        color: hexToRgba(palette.backgroundDark.hex, 0.4), margin: '0 0 2px',
      }}>
        {label}
      </p>
      <p style={{
        fontSize: 13.5, fontWeight: emphasize ? 750 : 600, margin: 0,
        color: danger
          ? palette.primaryMagenta.hex
          : emphasize
            ? palette.backgroundDark.hex
            : hexToRgba(palette.backgroundDark.hex, 0.75),
      }}>
        {value}
      </p>
    </div>
  );
}

function Chip({ children, strong, color }) {
  const c = color || hexToRgba(palette.backgroundDark.hex, 0.55);
  return (
    <span style={{
      fontSize: 11.5,
      fontWeight: strong ? 750 : 600,
      color: c,
      background: color ? hexToRgba(color, 0.12) : hexToRgba(palette.backgroundDark.hex, 0.06),
      borderRadius: 5,
      padding: '2px 7px',
    }}>
      {children}
    </span>
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
        fontSize: 12, fontWeight: primary ? 750 : 650, fontFamily: 'inherit',
        color: primary ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.65),
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}
    </button>
  );
}
