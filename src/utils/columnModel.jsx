import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import palette, { hexToRgba } from './colors.js';
import { filterIsActive, selectedFilterValues } from './columnFilters.js';

// ── Patient list column definitions ─────────────────────────────────────────
export const PATIENT_COLUMN_DEFS = [
  { key: 'patient',         label: 'Patient',         defaultOn: true,  alwaysOn: true,  sortField: 'last_name',      filterable: false },
  { key: 'division',        label: 'Division',         defaultOn: true,  sortField: 'division',        filterable: true  },
  { key: 'episode_type',    label: 'Episode',          defaultOn: true,  filterable: true, tooltip: 'Start of Care or Resumption of Care' },
  { key: 'licence',         label: 'Entity',           defaultOn: true,  filterable: true, tooltip: 'Wellbound licence (WB / WBII), assigned by county' },
  { key: 'stage',           label: 'Stage',            defaultOn: true,  sortField: 'stage',           filterable: true  },
  { key: 'triage',          label: 'Triage',           defaultOn: true,  filterable: true, tooltip: 'Special Needs triage. Filter: Done · Needed · N/A' },
  { key: 'f2f',  label: 'F2F',  tooltip: 'Face-to-Face authorization — shows days until the F2F order expires (red = expired, orange = ≤14d remaining)',  defaultOn: true, filterable: false },
  { key: 'days_in_stage',    label: 'Days in Stage',    defaultOn: true, filterable: true, sortField: 'days_in_stage',    tooltip: 'Days in current stage — resets on every stage change. Filter accepts a number; matches stages with at least that many days.' },
  { key: 'days_in_pipeline', label: 'Days in Pipeline', defaultOn: true, filterable: true, sortField: 'days_in_pipeline', tooltip: 'Days since the referral was created — never resets. Filter accepts a number.' },
  { key: 'marketer',        label: 'Marketer',         defaultOn: true,  filterable: true  },
  { key: 'insurance',       label: 'Insurance',        defaultOn: true,  sortField: 'insurance_plan',  filterable: true  },
  { key: 'referral_date',   label: 'Referral Date',    defaultOn: true,  filterable: true  },
  { key: 'referral_source', label: 'Referral Source',  defaultOn: true, filterable: true  },
  { key: 'source_entity',   label: 'Referral Entity',  defaultOn: true, filterable: true, tooltip: 'Company or CCO of the referral source — not the Wellbound licence' },
  { key: 'facility',        label: 'Facility',         defaultOn: true, filterable: true  },
  { key: 'physician',       label: 'Physician',        defaultOn: true, filterable: true  },
  // Urgent care lives at the END so it doesn't crowd the patient label
  // (the row's name already carries the small red cross when flagged).
  { key: 'urgent',          label: 'Urgent',           defaultOn: true,  filterable: true, tooltip: 'Patient flagged as requiring urgent / pre-SOC care. Filter accepts yes / no.' },
];

// ── Module page column definitions ──────────────────────────────────────────
export const MODULE_COLUMN_DEFS = [
  { key: 'patient',   label: 'Patient',    defaultOn: true, alwaysOn: true, filterable: false },
  { key: 'division',  label: 'Division',   defaultOn: true, filterable: true },
  { key: 'episode_type', label: 'Episode', defaultOn: true, filterable: true, tooltip: 'Start of Care or Resumption of Care' },
  { key: 'licence',   label: 'Entity',     defaultOn: true, filterable: true, tooltip: 'Wellbound licence (WB / WBII), assigned by county' },
  { key: 'source',    label: 'Source',     defaultOn: true, filterable: true },
  { key: 'source_entity', label: 'Referral Entity', defaultOn: true, filterable: true, tooltip: 'Company or CCO of the referral source — not the Wellbound licence' },
  { key: 'marketer',  label: 'Marketer',   defaultOn: true, filterable: true },
  { key: 'stage',     label: 'Stage',      defaultOn: true, filterable: true, tooltip: 'Current pipeline stage' },
  { key: 'triage',    label: 'Triage',     defaultOn: true, filterable: true, tooltip: 'Special Needs triage. Filter: Done · Needed · N/A' },
  { key: 'days_in_stage',    label: 'Days in Stage',    defaultOn: true, filterable: true, sortField: 'days_in_stage',    tooltip: 'Days in the pipeline stage on the Stage badge. Resets when that stage changes. On Clinical, this is not days sitting in review.' },
  { key: 'days_in_review',   label: 'Days in Review',   defaultOn: false, filterable: true, sortField: 'days_in_review',   tooltip: 'Days in the Clinical Review queue. Starts when the case is pushed or assigned here. Can differ from the pipeline stage clock.' },
  { key: 'days_in_pipeline', label: 'Days in Pipeline', defaultOn: true, filterable: true, sortField: 'days_in_pipeline', tooltip: 'Days since the referral was created — never resets. Filter accepts a number.' },
  { key: 'f2f',       label: 'F2F',        defaultOn: true, filterable: false, tooltip: 'F2F authorization countdown' },
  { key: 'owner',     label: 'Owner',      defaultOn: true, filterable: true },
  { key: 'insurance', label: 'Insurance',  defaultOn: true, filterable: true },
  { key: 'facility',  label: 'Facility',   defaultOn: true, filterable: true },
  { key: 'emr_onboarded', label: 'EMR Onboarded', defaultOn: true, filterable: true, tooltip: 'Yes if initial or full EMR onboarding has been completed. Filter accepts yes / no.' },
  { key: 'soc_completed_date', label: 'SOC/ROC Completed', defaultOn: true, filterable: true, sortField: 'soc_completed_date', tooltip: 'Date the SOC or ROC visit was completed. Filter accepts yes / no.' },
  { key: 'soc_scheduled_date', label: 'SOC/ROC Scheduled', defaultOn: true, filterable: true, sortField: 'soc_scheduled_date', tooltip: 'Date the SOC or ROC visit is scheduled for. Filter accepts yes / no.' },
  { key: 'activity',  label: 'Last Activity', defaultOn: true, filterable: false },
  // Urgent care lives at the END so it doesn't crowd the patient label
  // (the row's name already carries the small red cross when flagged).
  { key: 'urgent',    label: 'Urgent',     defaultOn: true, filterable: true, tooltip: 'Patient flagged as requiring urgent care. Filter accepts yes / no.' },
  // 'post_soc_docs' (deferred-docs status) was removed: visits and paperwork
  // run side by side as the status quo — SOC/ROC Completed/Scheduled columns
  // carry the post-visit signal now.
];

/** Clinical queue shows Days in Review so both clocks are visible. */
export function moduleColumnDefsForStage(stageName) {
  if (stageName === 'Staffing Feasibility') {
    return MODULE_COLUMN_DEFS
      .filter((c) => c.key !== 'days_in_review')
      .map((c) => (
        c.key === 'days_in_stage'
          ? {
            ...c,
            label: 'Days in Staffing',
            tooltip: 'Days since the hard push to Staffing (On Track / green check). Concurrent radar cases that are still in Intake or Clinical do not start this clock.',
          }
          : c
      ));
  }
  if (stageName !== 'Clinical Intake RN Review') {
    return MODULE_COLUMN_DEFS.filter((c) => c.key !== 'days_in_review');
  }
  return MODULE_COLUMN_DEFS.map((c) => (
    c.key === 'days_in_review' ? { ...c, defaultOn: true } : c
  ));
}

/**
 * SOC Completed — Pending Log alternate queue.
 * Fixed column set for account-manager / scheduling follow-up.
 */
export const SOC_COMPLETED_PENDING_LOG_COLUMN_DEFS = [
  { key: 'added_to_module', label: 'Added to module', defaultOn: true, alwaysOn: true, filterable: false, sortField: 'added_to_module', tooltip: 'Date the patient entered SOC Completed' },
  { key: 'patient', label: 'Patient', defaultOn: true, alwaysOn: true, filterable: false, sortField: 'name' },
  { key: 'facility', label: 'Facility', defaultOn: true, filterable: true },
  { key: 'episode_type', label: 'Episode', defaultOn: true, filterable: true, tooltip: 'Start of Care or Resumption of Care' },
  { key: 'licence', label: 'Entity', defaultOn: true, filterable: true, tooltip: 'Wellbound licence (WB / WBII), assigned by county' },
  { key: 'source_entity', label: 'Referral Entity', defaultOn: true, filterable: true, tooltip: 'Company or CCO of the referral source — not the Wellbound licence' },
  { key: 'triage', label: 'Triage', defaultOn: true, filterable: true, tooltip: 'Special Needs triage. Filter: Done · Needed · N/A' },
  { key: 'insurance', label: 'Insurance', defaultOn: true, filterable: true },
  { key: 'urgent', label: 'Urgent care', defaultOn: true, filterable: true, tooltip: 'Urgent / pre-care flag. Filter: yes / no' },
  { key: 'urgent_care_type', label: 'Urgent type', defaultOn: true, filterable: true, tooltip: 'Wound care, Insulin, and Injection. Multiple can be selected.' },
  { key: 'soc_completed_date', label: 'Completed', defaultOn: true, filterable: false, sortField: 'soc_completed_date', tooltip: 'Date SOC or ROC was completed' },
  { key: 'waiting_docs', label: 'Waiting for docs', defaultOn: true, filterable: true, tooltip: 'Deferred F2F/clinical still outstanding. Filter: yes / no' },
  { key: 'pcp', label: 'PCP', defaultOn: true, filterable: true, tooltip: 'Triage PCP when present; otherwise the referral physician' },
  { key: 'marketer', label: 'Marketer', defaultOn: true, filterable: true },
  { key: 'account_manager_info', label: 'Account manager info', defaultOn: true, filterable: false, tooltip: 'Notes from nurses via @Account manager info (multiple entries). May also show a clinical send-back note.' },
  { key: 'clinical_rn', label: 'Clinical Review RN', defaultOn: true, filterable: true },
];

// ── Hooks ───────────────────────────────────────────────────────────────────

function defsSignature(columnDefs) {
  return (columnDefs || []).map((c) => c.key).join('|');
}

export function useColumnVisibility(columnDefs) {
  const [visibleCols, setVisibleCols] = useState(
    () => new Set(columnDefs.filter((c) => c.defaultOn).map((c) => c.key))
  );
  const sig = defsSignature(columnDefs);
  useEffect(() => {
    setVisibleCols(new Set(columnDefs.filter((c) => c.defaultOn).map((c) => c.key)));
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when column set changes
  const activeColumns = useMemo(
    () => columnDefs.filter((c) => visibleCols.has(c.key)),
    [columnDefs, visibleCols]
  );
  return { visibleCols, setVisibleCols, activeColumns };
}

export function useColumnFilters(columnDefs) {
  const defaultFilters = useMemo(
    () => Object.fromEntries(columnDefs.filter((c) => c.filterable).map((c) => [c.key, []])),
    [columnDefs]
  );
  const [colFilters, setColFilters] = useState({ ...defaultFilters });
  const [showFilters, setShowFilters] = useState(false);
  const sig = defsSignature(columnDefs);
  useEffect(() => {
    setColFilters({ ...defaultFilters });
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  function setColFilter(key, val) {
    setColFilters((prev) => ({ ...prev, [key]: Array.isArray(val) ? val : selectedFilterValues(val) }));
  }
  function clearFilters() {
    setColFilters({ ...defaultFilters });
  }
  const hasActiveFilters = useMemo(
    () => Object.values(colFilters).some(filterIsActive),
    [colFilters]
  );

  return { colFilters, setColFilter, clearFilters, showFilters, setShowFilters, hasActiveFilters };
}

/** @deprecated use ColumnFilterButton — kept so older imports still resolve */
export function FilterInput(props) {
  return <ColumnFilterButton {...props} />;
}

/**
 * Per-column multi-select. Lives in the header so toggling Filters never
 * inserts a second row or shifts the queue.
 */
export function ColumnFilterButton({ value, onChange, placeholder, options = [], label }) {
  const selected = selectedFilterValues(value);
  const hasValue = selected.length > 0;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const title = label || placeholder || 'Filter';

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    const list = options.map(String);
    if (!query) return list;
    return list.filter((opt) => opt.toLowerCase().includes(query));
  }, [options, q]);

  function toggle(opt) {
    const next = selected.includes(opt)
      ? selected.filter((s) => s !== opt)
      : [...selected, opt];
    onChange(next);
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button
        type="button"
        aria-label={`Filter ${title}`}
        aria-expanded={open}
        title={hasValue ? `${title}: ${selected.join(', ')}` : `Filter ${title}`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        style={{
          width: 18, height: 18, padding: 0, border: 'none', borderRadius: 4,
          background: 'transparent', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: hasValue ? palette.accentBlue.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" stroke="currentColor" strokeWidth={hasValue ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 40,
            minWidth: 200, maxWidth: 280, maxHeight: 280,
            background: palette.backgroundLight.hex,
            border: `1px solid var(--color-border)`,
            borderRadius: 8,
            boxShadow: `0 8px 24px ${hexToRgba(palette.backgroundDark.hex, 0.14)}`,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}
        >
          <div style={{ padding: '8px 10px 6px', flexShrink: 0 }}>
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}…`}
              style={{
                width: '100%', height: 28, padding: '0 8px', borderRadius: 6,
                border: `1px solid var(--color-border)`, background: palette.backgroundLight.hex,
                fontSize: 12, color: palette.backgroundDark.hex, outline: 'none',
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, padding: '2px 0 6px' }}>
            {shown.length === 0 ? (
              <p style={{ padding: '10px 12px', margin: 0, fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                No options
              </p>
            ) : shown.map((opt) => {
              const checked = selected.includes(opt);
              return (
                <label
                  key={opt}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 12px', cursor: 'pointer',
                    background: checked ? hexToRgba(palette.accentBlue.hex, 0.05) : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt)}
                    style={{ accentColor: palette.accentBlue.hex, width: 13, height: 13, flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 12.5, color: palette.backgroundDark.hex }}>{opt}</span>
                </label>
              );
            })}
          </div>
          {hasValue && (
            <div style={{ borderTop: `1px solid var(--color-border)`, padding: '6px 10px', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => onChange([])}
                style={{
                  border: 'none', background: 'none', padding: 0, cursor: 'pointer',
                  fontSize: 12, fontWeight: 650, color: palette.primaryMagenta.hex, fontFamily: 'inherit',
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ColumnPicker ────────────────────────────────────────────────────────────

export function ColumnPicker({
  columnDefs,
  visibleCols,
  onChange,
  onClose,
  freezePatient = null,
  onFreezePatientChange = null,
}) {
  const ref = useRef(null);
  const [maxHeight, setMaxHeight] = useState(480);
  const showFreezeToggle = typeof freezePatient === 'boolean' && typeof onFreezePatientChange === 'function';

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    function update() {
      const top = el.getBoundingClientRect().top;
      setMaxHeight(Math.max(180, window.innerHeight - top - 12));
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        marginTop: 4,
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        maxHeight,
        minWidth: 220,
        background: palette.backgroundLight.hex,
        border: `1px solid var(--color-border)`,
        borderRadius: 8,
        padding: '8px 0',
        boxShadow: `0 6px 20px ${hexToRgba(palette.backgroundDark.hex, 0.12)}`,
      }}
    >
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), padding: '2px 14px 8px', flexShrink: 0 }}>Columns</p>
      <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, overscrollBehavior: 'contain' }}>
        {columnDefs.map((col) => (
          <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 14px', cursor: col.alwaysOn ? 'default' : 'pointer', opacity: col.alwaysOn ? 0.45 : 1 }}>
            <input
              type="checkbox"
              checked={visibleCols.has(col.key)}
              disabled={col.alwaysOn}
              onChange={() => {
                if (col.alwaysOn) return;
                const next = new Set(visibleCols);
                if (next.has(col.key)) next.delete(col.key);
                else next.add(col.key);
                onChange(next);
              }}
              style={{ accentColor: palette.primaryMagenta.hex, width: 13, height: 13 }}
            />
            <span style={{ fontSize: 12.5, color: palette.backgroundDark.hex }}>{col.label}</span>
          </label>
        ))}
      </div>
      {showFreezeToggle && (
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--color-border)', marginTop: 4, paddingTop: 8 }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), padding: '2px 14px 8px' }}>Freeze</p>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '5px 14px 4px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={freezePatient}
              onChange={(e) => onFreezePatientChange(e.target.checked)}
              style={{ accentColor: palette.primaryMagenta.hex, width: 13, height: 13, marginTop: 2 }}
            />
            <span>
              <span style={{ fontSize: 12.5, color: palette.backgroundDark.hex, display: 'block' }}>Freeze Patient column</span>
              <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.35, display: 'block', marginTop: 2 }}>
                Keep the patient name visible while scrolling columns
              </span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}

// ── SVG Icons ───────────────────────────────────────────────────────────────

export const FilterIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>;
export const ColsIcon = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.7"/><rect x="14" y="3" width="7" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.7"/></svg>;
