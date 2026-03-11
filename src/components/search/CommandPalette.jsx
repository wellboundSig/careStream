import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPatients } from '../../api/patients.js';
import { getReferrals } from '../../api/referrals.js';
import { getPhysicians } from '../../api/physicians.js';
import { getReferralSources } from '../../api/referralSources.js';
import { getMarketers } from '../../api/marketers.js';
import { getFacilities } from '../../api/facilities.js';
import { usePatientDrawer } from '../../context/PatientDrawerContext.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

// Module-level cache — persists across palette opens within the session
let _cache    = null;
let _loading  = false; // prevent duplicate parallel fetches

function matchStr(text, q) {
  if (!text || !q) return false;
  return String(text).toLowerCase().includes(q.toLowerCase());
}

const STAGE_ROUTES = {
  'Lead Entry':                '/modules/lead-entry',
  'Intake':                    '/modules/intake',
  'Eligibility Verification':  '/modules/eligibility',
  'Disenrollment Required':    '/modules/disenrollment',
  'F2F/MD Orders Pending':     '/modules/f2f',
  'Clinical Intake RN Review': '/modules/clinical-rn',
  'Authorization Pending':     '/modules/authorization',
  'Conflict':                  '/modules/conflict',
  'Staffing Feasibility':      '/modules/staffing',
  'Admin Confirmation':        '/modules/admin-confirmation',
  'Pre-SOC':                   '/modules/pre-soc',
  'SOC Scheduled':             '/modules/soc-scheduled',
  'SOC Completed':             '/modules/soc-completed',
  'Hold':                      '/modules/hold',
  'NTUC':                      '/modules/ntuc',
};

const CATEGORY_META = {
  patients:   { label: 'Patients',        color: palette.primaryMagenta.hex },
  physicians: { label: 'Physicians',      color: palette.accentBlue.hex },
  sources:    { label: 'Referral Sources',color: palette.accentGreen.hex },
  marketers:  { label: 'Marketers',       color: palette.accentOrange.hex },
  facilities: { label: 'Facilities',      color: hexToRgba(palette.backgroundDark.hex, 0.45) },
};

export default function CommandPalette({ isOpen, onClose }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(-1); // flat index for keyboard nav

  const inputRef    = useRef(null);
  const listRef     = useRef(null);
  const navigate    = useNavigate();
  const { open: openDrawer } = usePatientDrawer();

  // Preload data on mount so search is instant when palette opens
  useEffect(() => { if (!_cache && !_loading) loadData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus input & reset on open
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults(null);
      setFocused(-1);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [isOpen]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  async function loadData() {
    if (_loading) return;
    _loading = true;
    setLoading(true);
    try {
      const [rawPatients, rawReferrals, rawPhysicians, rawSources, rawMarketers, rawFacilities] =
        await Promise.all([
          getPatients(),
          getReferrals(),
          getPhysicians(),
          getReferralSources(),
          getMarketers(),
          getFacilities(),
        ]);

      // Build patient map keyed by app-level id
      const patientMap = {};
      rawPatients.forEach((p) => {
        if (p.fields.id) patientMap[p.fields.id] = p;
        patientMap[p.id] = p; // fallback by Airtable record ID
      });

      // Enrich referrals with patient data (one referral per patient, most recent)
      const seenPatients = new Set();
      const enrichedReferrals = [];
      rawReferrals
        .sort((a, b) => new Date(b.fields.referral_date || 0) - new Date(a.fields.referral_date || 0))
        .forEach((r) => {
          const pid = r.fields.patient_id;
          if (!pid || seenPatients.has(pid)) return;
          seenPatients.add(pid);
          const p = patientMap[pid];
          enrichedReferrals.push({
            _id:         r.id,
            ...r.fields,
            patientName: p ? `${p.fields.first_name || ''} ${p.fields.last_name || ''}`.trim() : pid,
            patientDob:  p?.fields.dob || null,
            patient:     p ? { _id: p.id, ...p.fields } : null,
          });
        });

      _cache = {
        patients:   enrichedReferrals,
        physicians: rawPhysicians.map((r) => ({ _id: r.id, ...r.fields })),
        sources:    rawSources.map((r)    => ({ _id: r.id, ...r.fields })),
        marketers:  rawMarketers.map((r)  => ({ _id: r.id, ...r.fields })),
        facilities: rawFacilities.map((r) => ({ _id: r.id, ...r.fields })),
      };
      if (query) runFilter(query);
    } catch { /* fail silently */ }
    finally { _loading = false; setLoading(false); }
  }

  const runFilter = useCallback((q) => {
    if (!_cache || !q.trim()) { setResults(null); return; }
    const patients = _cache.patients.filter((r) =>
      matchStr(r.patientName, q) ||
      matchStr(r.patient?.medicaid_number, q) ||
      matchStr(r.patient?.phone_primary, q) ||
      matchStr(r.patient?.dob, q) ||
      matchStr(r.current_stage, q) ||
      matchStr(r.division, q)
    ).slice(0, 5);

    const physicians = _cache.physicians.filter((p) =>
      matchStr(`${p.first_name} ${p.last_name}`, q) ||
      matchStr(p.npi, q)
    ).slice(0, 4);

    const sources = _cache.sources.filter((s) =>
      matchStr(s.name, q)
    ).slice(0, 4);

    const marketers = _cache.marketers.filter((m) =>
      matchStr(`${m.first_name} ${m.last_name}`, q)
    ).slice(0, 4);

    const facilities = _cache.facilities.filter((f) =>
      matchStr(f.name, q) ||
      matchStr(f.address, q)
    ).slice(0, 4);

    // Always set a full object so every key is defined — empty arrays are fine
    setResults({ patients, physicians, sources, marketers, facilities });
  }, []);

  useEffect(() => {
    if (_cache) runFilter(query);
    setFocused(-1);
  }, [query, runFilter]);

  // Build flat list of items for keyboard nav — guard every array in case results is partial
  const flatItems = results
    ? [
        ...(results.patients   || []).map((r) => ({ type: 'patient',   data: r })),
        ...(results.physicians || []).map((p) => ({ type: 'physician', data: p })),
        ...(results.sources    || []).map((s) => ({ type: 'source',    data: s })),
        ...(results.marketers  || []).map((m) => ({ type: 'marketer',  data: m })),
        ...(results.facilities || []).map((f) => ({ type: 'facility',  data: f })),
      ]
    : [];

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocused((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocused((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && focused >= 0 && flatItems[focused]) {
      handleSelect(flatItems[focused]);
    }
  }

  function handleSelect({ type, data }) {
    onClose();
    if (type === 'patient') {
      openDrawer(data);
    } else if (type === 'physician') {
      navigate('/directory/physicians');
    } else if (type === 'source') {
      navigate('/directory/referral-sources');
    } else if (type === 'marketer') {
      navigate('/directory/marketers');
    } else if (type === 'facility') {
      navigate('/directory/facilities');
    }
  }

  if (!isOpen) return null;

  let flatIdx = 0;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: hexToRgba(palette.backgroundDark.hex, 0.55),
        backdropFilter: 'blur(3px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 540,
          background: palette.backgroundLight.hex,
          borderRadius: 14,
          boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.28)}`,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '68vh',
        }}
      >
        {/* Input row */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 18px',
          borderBottom: `1px solid var(--color-border)`,
        }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="2" />
            <path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search patients, physicians, sources, facilities…"
            style={{
              flex: 1, border: 'none', outline: 'none',
              fontSize: 15, fontFamily: 'inherit',
              color: palette.backgroundDark.hex,
              background: 'transparent',
            }}
          />
          {loading && (
            <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Loading…</span>
          )}
          <kbd style={{
            fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.35),
            background: hexToRgba(palette.backgroundDark.hex, 0.06),
            border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.15)}`,
            borderRadius: 5, padding: '2px 6px', fontFamily: 'inherit',
          }}>
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>

          {/* Empty state — no query */}
          {!query.trim() && !loading && (
            <div style={{ padding: '28px 20px', textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), lineHeight: 1.6 }}>
                Search by patient name, Medicaid number, phone, physician, facility, referral source, or marketer.
              </p>
            </div>
          )}

          {/* No results */}
          {query.trim() && results && !flatItems.length && !loading && (
            <div style={{ padding: '28px 20px', textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                No results for <strong>"{query}"</strong>
              </p>
            </div>
          )}

          {/* Still loading data on first open */}
          {query.trim() && !results && loading && (
            <div style={{ padding: '28px 20px', textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Loading index…</p>
            </div>
          )}

          {/* Result groups */}
          {results && Object.entries(results).map(([cat, items]) => {
            if (!items.length) return null;
            const meta = CATEGORY_META[cat];
            return (
              <div key={cat}>
                {/* Category header */}
                <div style={{
                  padding: '7px 18px 4px',
                  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
                  color: meta.color,
                  background: hexToRgba(meta.color, 0.04),
                  borderBottom: `1px solid ${hexToRgba(meta.color, 0.08)}`,
                }}>
                  {meta.label.toUpperCase()}
                </div>

                {items.map((item) => {
                  const myIdx = flatIdx++;
                  const isFocused = focused === myIdx;

                  let primary = '';
                  let secondary = '';
                  let badge = '';

                  if (cat === 'patients') {
                    primary   = item.patientName || '—';
                    secondary = [item.division, item.current_stage].filter(Boolean).join(' · ');
                    badge     = item.patient?.medicaid_number || '';
                  } else if (cat === 'physicians') {
                    primary   = `${item.first_name || ''} ${item.last_name || ''}`.trim() || '—';
                    secondary = item.npi ? `NPI: ${item.npi}` : '';
                    badge     = item.specialty || '';
                  } else if (cat === 'sources') {
                    primary   = item.name || '—';
                    secondary = [item.type, item.region].filter(Boolean).join(' · ');
                  } else if (cat === 'marketers') {
                    primary   = `${item.first_name || ''} ${item.last_name || ''}`.trim() || '—';
                    secondary = item.region || '';
                  } else if (cat === 'facilities') {
                    primary   = item.name || '—';
                    secondary = item.address || item.region || '';
                  }

                  return (
                    <div
                      key={item._id}
                      onClick={() => handleSelect({ type: cat === 'patients' ? 'patient' : cat.replace(/s$/, ''), data: item })}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '9px 18px',
                        cursor: 'pointer',
                        background: isFocused ? hexToRgba(meta.color, 0.06) : 'transparent',
                        borderLeft: isFocused ? `3px solid ${meta.color}` : '3px solid transparent',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={() => setFocused(myIdx)}
                      onMouseLeave={() => setFocused(-1)}
                    >
                      {/* Color dot */}
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: meta.color, flexShrink: 0,
                      }} />

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 13, fontWeight: 600,
                          color: palette.backgroundDark.hex,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {primary}
                        </div>
                        {secondary && (
                          <div style={{
                            fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45),
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            marginTop: 1,
                          }}>
                            {secondary}
                          </div>
                        )}
                      </div>

                      {badge && (
                        <span style={{
                          fontSize: 10.5, fontWeight: 600,
                          color: hexToRgba(palette.backgroundDark.hex, 0.45),
                          background: hexToRgba(palette.backgroundDark.hex, 0.05),
                          borderRadius: 4, padding: '2px 7px',
                          flexShrink: 0,
                        }}>
                          {badge}
                        </span>
                      )}

                      {/* Arrow hint on focus */}
                      {isFocused && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
                          <path d="M5 12h14M12 5l7 7-7 7" stroke={palette.backgroundDark.hex} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Footer hint */}
        <div style={{
          padding: '8px 18px',
          borderTop: `1px solid var(--color-border)`,
          display: 'flex', gap: 14, alignItems: 'center',
        }}>
          {[['↑↓', 'Navigate'], ['↵', 'Open'], ['esc', 'Close']].map(([key, label]) => (
            <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
              <kbd style={{
                fontFamily: 'inherit', fontSize: 10.5,
                background: hexToRgba(palette.backgroundDark.hex, 0.06),
                border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.14)}`,
                borderRadius: 4, padding: '1px 5px',
              }}>{key}</kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
