import { useState, useEffect, useRef } from 'react';
import { createPhysician } from '../../api/physicians.js';
import { buildPhysicianSeedFromNpi, searchNpiProviders } from '../../api/cms.js';
import { clearLookupsCache } from '../../hooks/useLookups.js';
import { refreshPhysicians } from '../../hooks/usePhysicians.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { normalizePhysicianTitle } from '../../utils/physicianName.js';
import { normalizePhone, lookupZip } from '../../utils/validation.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const EMPTY_FORM = {
  first_name: '',
  last_name: '',
  title: '',
  npi: '',
  phone: '',
  fax: '',
  address_street: '',
  address_city: '',
  address_state: '',
  address_zip: '',
  is_pecos_enrolled: false,
  is_opra_enrolled: false,
};

// ── Shared field primitives ──────────────────────────────────────────────────

function inputStyle(focused, hasError, disabled) {
  return {
    width: '100%',
    height: 38,
    padding: '0 12px',
    borderRadius: 9,
    border: `1px solid ${hasError ? palette.primaryMagenta.hex : focused ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.12)}`,
    fontSize: 13.5,
    fontFamily: 'inherit',
    outline: 'none',
    background: disabled ? hexToRgba(palette.backgroundDark.hex, 0.04) : '#fff',
    color: disabled ? hexToRgba(palette.backgroundDark.hex, 0.45) : palette.backgroundDark.hex,
    boxSizing: 'border-box',
    transition: 'border-color 0.12s, box-shadow 0.12s',
    boxShadow: focused && !hasError ? `0 0 0 3px ${hexToRgba(palette.primaryDeepPlum.hex, 0.08)}` : 'none',
    cursor: disabled ? 'not-allowed' : 'text',
  };
}

function Field({ label, required, error, hint, children }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label style={{
        display: 'block', fontSize: 11, fontWeight: 650,
        letterSpacing: '0.04em', textTransform: 'uppercase',
        color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 6,
      }}>
        {label}
        {required && <span style={{ color: palette.primaryMagenta.hex, marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {error ? (
        <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 5 }}>{error}</p>
      ) : hint ? (
        <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 5, lineHeight: 1.4 }}>{hint}</p>
      ) : null}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text', autoFocus, maxLength, hasError, onEnter, inputMode, inputRef }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      ref={inputRef}
      type={type}
      inputMode={inputMode}
      value={value || ''}
      placeholder={placeholder}
      autoFocus={autoFocus}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }}
      style={inputStyle(focused, hasError, false)}
    />
  );
}

function SectionLabel({ children }) {
  return (
    <p style={{
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: hexToRgba(palette.backgroundDark.hex, 0.38),
      paddingBottom: 8, borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
    }}>
      {children}
    </p>
  );
}

function Pill({ ok, label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontSize: 11.5, fontWeight: 650, padding: '3px 10px', borderRadius: 20,
      background: ok ? hexToRgba(palette.accentGreen.hex, 0.13) : hexToRgba(palette.backgroundDark.hex, 0.06),
      color: ok ? '#2e7d52' : hexToRgba(palette.backgroundDark.hex, 0.45),
    }}>
      {ok ? (
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      ) : (
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', opacity: 0.5 }} />
      )}
      {label}
    </span>
  );
}

function PrimaryButton({ onClick, disabled, busy, children, subtle }) {
  const [hov, setHov] = useState(false);
  const active = !disabled && !busy;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        height: 38, padding: '0 20px', borderRadius: 9, border: 'none',
        background: subtle
          ? (active && hov ? hexToRgba(palette.primaryDeepPlum.hex, 0.14) : hexToRgba(palette.primaryDeepPlum.hex, 0.09))
          : active
            ? (hov ? palette.primaryMagenta.hex : palette.primaryDeepPlum.hex)
            : hexToRgba(palette.backgroundDark.hex, 0.08),
        color: subtle
          ? (active ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.35))
          : active ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.35),
        fontSize: 13, fontWeight: 650, fontFamily: 'inherit',
        cursor: busy ? 'wait' : active ? 'pointer' : 'not-allowed',
        transition: 'background 0.12s',
        whiteSpace: 'nowrap',
        display: 'inline-flex', alignItems: 'center', gap: 7, justifyContent: 'center',
      }}
    >
      {busy && <Spinner light={!subtle} />}
      {children}
    </button>
  );
}

function GhostButton({ onClick, children }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        height: 38, padding: '0 16px', borderRadius: 9,
        border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.12)}`,
        background: hov ? hexToRgba(palette.backgroundDark.hex, 0.04) : 'transparent',
        color: hexToRgba(palette.backgroundDark.hex, 0.65),
        fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
        transition: 'background 0.12s', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

function Spinner({ light }) {
  return (
    <span
      aria-hidden
      style={{
        width: 13, height: 13, borderRadius: '50%',
        border: `2px solid ${light ? 'rgba(255,255,255,0.35)' : hexToRgba(palette.primaryDeepPlum.hex, 0.25)}`,
        borderTopColor: light ? '#fff' : palette.primaryDeepPlum.hex,
        display: 'inline-block',
        animation: 'phy-spin 0.7s linear infinite',
      }}
    />
  );
}

// ── Step indicator ───────────────────────────────────────────────────────────

function Steps({ step }) {
  const items = [
    { n: 1, label: 'Find physician' },
    { n: 2, label: 'Review & save' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {items.map((it, i) => {
        const active = step === it.n;
        const done = step > it.n;
        return (
          <div key={it.n} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10.5, fontWeight: 800,
                background: done || active ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.08),
                color: done || active ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.4),
                transition: 'background 0.2s',
              }}>
                {done ? (
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                ) : it.n}
              </span>
              <span style={{
                fontSize: 12, fontWeight: active ? 700 : 550,
                color: active ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.4),
              }}>
                {it.label}
              </span>
            </div>
            {i < items.length - 1 && (
              <span style={{ width: 26, height: 1.5, background: hexToRgba(palette.backgroundDark.hex, 0.12), borderRadius: 1 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────

/**
 * Two-step create wizard: find the physician in CMS (NPI or NPPES name
 * search) to seed a complete record, then review/edit and save. Manual
 * entry skips straight to step 2 with a blank form.
 */
export default function AddPhysicianModal({ onClose, onAdded }) {
  const { appUserId } = useCurrentAppUser();
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState('npi'); // 'npi' | 'name'

  const [form, setForm] = useState(EMPTY_FORM);
  const [verification, setVerification] = useState(null);
  const [lookupMeta, setLookupMeta] = useState(null);

  const [wizardNpi, setWizardNpi] = useState('');
  const [searchFirst, setSearchFirst] = useState('');
  const [searchLast, setSearchLast] = useState('');
  const [searchState, setSearchState] = useState('NY');
  const [searchHits, setSearchHits] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loadingNpi, setLoadingNpi] = useState(null); // npi being seeded (for row spinners)
  const [searching, setSearching] = useState(false);
  const [wizardError, setWizardError] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [animated, setAnimated] = useState(false);
  const npiRef = useRef(null);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const npiDigitsOf = (v) => String(v || '').replace(/\D/g, '');
  const wizardNpiReady = npiDigitsOf(wizardNpi).length === 10;
  const nameSearchReady = searchLast.trim().length >= 2;

  useEffect(() => {
    const t = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus the NPI input when the modal opens on step 1.
  useEffect(() => {
    if (step === 1 && mode === 'npi') {
      const t = setTimeout(() => npiRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [step, mode]);

  async function applySeedFromNpi(npi) {
    const clean = npiDigitsOf(npi);
    if (clean.length !== 10) {
      setWizardError('Enter a valid 10-digit NPI to look up.');
      return;
    }
    setLoadingNpi(clean);
    setWizardError('');
    try {
      const seed = await buildPhysicianSeedFromNpi(clean);
      setForm((f) => ({ ...f, ...seed.form }));
      setVerification(seed.verification);
      setLookupMeta(seed.meta);
      setStep(2);
    } catch (e) {
      setWizardError(e.message || 'CMS lookup failed.');
    } finally {
      setLoadingNpi(null);
    }
  }

  async function handleNameSearch() {
    if (!nameSearchReady || searching) return;
    setSearching(true);
    setWizardError('');
    setSearchHits([]);
    try {
      const hits = await searchNpiProviders({
        firstName: searchFirst,
        lastName: searchLast,
        state: searchState,
      });
      setSearchHits(hits);
      setSearched(true);
    } catch (e) {
      setWizardError(e.message || 'NPPES search failed.');
    } finally {
      setSearching(false);
    }
  }

  function startManual() {
    setForm(EMPTY_FORM);
    setVerification(null);
    setLookupMeta(null);
    setStep(2);
  }

  function backToSearch() {
    setStep(1);
    setError('');
    setFieldErrors({});
  }

  async function handleSave() {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError('First name and last name are required.');
      return;
    }

    const errs = {};
    let cleanPhone = form.phone?.trim() || '';
    let cleanFax = form.fax?.trim() || '';
    let cleanCity = form.address_city;
    let cleanState = form.address_state;
    const cleanTitle = normalizePhysicianTitle(form.title);

    if (cleanPhone) {
      const r = normalizePhone(cleanPhone);
      if (!r.valid) errs.phone = r.error;
      else cleanPhone = r.digits;
    }
    if (cleanFax) {
      const r = normalizePhone(cleanFax);
      if (!r.valid) errs.fax = r.error;
      else cleanFax = r.digits;
    }
    if (form.address_zip?.trim()) {
      const r = lookupZip(form.address_zip);
      if (!r.valid) errs.address_zip = r.error;
      else {
        if (!cleanCity?.trim()) cleanCity = r.city;
        if (!cleanState?.trim()) cleanState = r.state;
      }
    }
    const npiDigits = npiDigitsOf(form.npi);
    if (npiDigits && npiDigits.length !== 10) errs.npi = 'NPI must be exactly 10 digits';

    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setForm((f) => ({
      ...f,
      phone: cleanPhone,
      fax: cleanFax,
      address_city: cleanCity,
      address_state: cleanState,
      title: cleanTitle,
    }));

    setSaving(true);
    setError('');
    try {
      const fields = {
        id: `phy_${Date.now().toString(36)}`,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        ...(cleanTitle ? { title: cleanTitle } : {}),
        ...(npiDigits ? { npi: npiDigits } : {}),
        ...(cleanPhone ? { phone: cleanPhone } : {}),
        ...(cleanFax ? { fax: cleanFax } : {}),
        ...(form.address_street ? { address_street: form.address_street.trim() } : {}),
        ...(cleanCity?.trim() ? { address_city: cleanCity.trim() } : {}),
        ...(cleanState?.trim() ? { address_state: cleanState.trim() } : {}),
        ...(form.address_zip ? { address_zip: form.address_zip.trim() } : {}),
        is_pecos_enrolled: form.is_pecos_enrolled ? true : null,
        is_opra_enrolled: form.is_opra_enrolled ? true : null,
        is_active: 'Active',
        created_at: new Date().toISOString(),
        ...(verification ? {
          ...verification,
          is_pecos_enrolled: form.is_pecos_enrolled ? true : null,
          is_opra_enrolled: form.is_opra_enrolled ? true : null,
          verification_checked_by_id: appUserId || 'unknown',
        } : {}),
      };
      const rec = await createPhysician(fields);
      const newPhy = { _id: rec.id, ...rec.fields };
      clearLookupsCache();
      refreshPhysicians();
      onAdded(newPhy);
    } catch (e) {
      setError(e.message || 'Failed to save. Please try again.');
      setSaving(false);
    }
  }

  // ── Step 1 content ─────────────────────────────────────────────────────────

  const modeTab = (id, label) => {
    const active = mode === id;
    return (
      <button
        type="button"
        onClick={() => { setMode(id); setWizardError(''); }}
        style={{
          flex: 1, height: 34, borderRadius: 8, border: 'none',
          background: active ? '#fff' : 'transparent',
          boxShadow: active ? `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.12)}` : 'none',
          color: active ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
          fontSize: 12.5, fontWeight: active ? 700 : 550, fontFamily: 'inherit',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        {label}
      </button>
    );
  };

  const stepOne = (
    <>
      {/* Mode toggle */}
      <div style={{
        display: 'flex', gap: 4, padding: 4, borderRadius: 10,
        background: hexToRgba(palette.backgroundDark.hex, 0.05),
        marginBottom: 22,
      }}>
        {modeTab('npi', 'I have the NPI')}
        {modeTab('name', 'Search by name')}
      </div>

      {mode === 'npi' ? (
        <div>
          <Field
            label="NPI number"
            hint="Pulls the full NPPES record — name, credential, practice address, phone, fax, plus live PECOS & OPRA status."
          >
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <Input
                  inputRef={npiRef}
                  value={wizardNpi}
                  onChange={(v) => setWizardNpi(npiDigitsOf(v).slice(0, 10))}
                  onEnter={() => wizardNpiReady && applySeedFromNpi(wizardNpi)}
                  placeholder="10-digit NPI, e.g. 1407163306"
                  inputMode="numeric"
                  maxLength={10}
                />
              </div>
              <PrimaryButton
                onClick={() => applySeedFromNpi(wizardNpi)}
                disabled={!wizardNpiReady}
                busy={!!loadingNpi}
              >
                {loadingNpi ? 'Looking up' : 'Look up'}
              </PrimaryButton>
            </div>
          </Field>
        </div>
      ) : (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 84px', gap: 12, marginBottom: 14 }}>
            <Field label="First name">
              <Input value={searchFirst} onChange={setSearchFirst} placeholder="Optional" onEnter={handleNameSearch} />
            </Field>
            <Field label="Last name" required>
              <Input value={searchLast} onChange={setSearchLast} placeholder="e.g. Walker" onEnter={handleNameSearch} autoFocus />
            </Field>
            <Field label="State">
              <Input value={searchState} onChange={(v) => setSearchState(v.toUpperCase().slice(0, 2))} placeholder="NY" maxLength={2} onEnter={handleNameSearch} />
            </Field>
          </div>
          <PrimaryButton onClick={handleNameSearch} disabled={!nameSearchReady} busy={searching}>
            {searching ? 'Searching NPPES' : 'Search NPPES'}
          </PrimaryButton>

          {searched && !searching && searchHits.length === 0 && !wizardError && (
            <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginTop: 14 }}>
              No matches. Try a different spelling or state — or enter the details manually below.
            </p>
          )}

          {searchHits.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 650, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 8 }}>
                {searchHits.length} match{searchHits.length === 1 ? '' : 'es'} — click to use
              </p>
              <div style={{
                borderRadius: 10, border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.09)}`,
                overflow: 'hidden', maxHeight: 264, overflowY: 'auto',
              }}>
                {searchHits.map((hit, i) => (
                  <SearchHitRow
                    key={hit.npi}
                    hit={hit}
                    last={i === searchHits.length - 1}
                    busy={loadingNpi === hit.npi}
                    disabled={!!loadingNpi}
                    onPick={() => applySeedFromNpi(hit.npi)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {wizardError && (
        <div style={{
          marginTop: 16, padding: '10px 14px', borderRadius: 9,
          background: hexToRgba(palette.primaryMagenta.hex, 0.06),
          border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.25)}`,
        }}>
          <p style={{ fontSize: 12.5, color: palette.primaryMagenta.hex }}>{wizardError}</p>
        </div>
      )}

      {/* Manual escape hatch */}
      <div style={{
        marginTop: 26, paddingTop: 18,
        borderTop: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.07)}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.5 }}>
          Can&apos;t find them, or no NPI on record?
        </p>
        <GhostButton onClick={startManual}>Enter manually</GhostButton>
      </div>
    </>
  );

  // ── Step 2 content ─────────────────────────────────────────────────────────

  const stepTwo = (
    <>
      {lookupMeta ? (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '13px 16px', borderRadius: 11, marginBottom: 22,
          background: hexToRgba(palette.accentGreen.hex, 0.07),
          border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.22)}`,
        }}>
          <span style={{
            width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
            background: hexToRgba(palette.accentGreen.hex, 0.16),
            color: '#2e7d52',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>
              Seeded from CMS{lookupMeta.providerName ? ` — ${lookupMeta.providerName}${form.title ? `, ${form.title}` : ''}` : ''}
            </p>
            {lookupMeta.taxonomy && (
              <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 8 }}>
                {lookupMeta.taxonomy}
              </p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <Pill ok={lookupMeta.npiStatus === 'active'} label={`NPI ${lookupMeta.npiStatus || '—'}`} />
              <Pill ok={lookupMeta.pecosEnrolled} label="PECOS" />
              <Pill ok={lookupMeta.opraEligible} label="OPRA" />
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          padding: '11px 16px', borderRadius: 11, marginBottom: 22,
          background: hexToRgba(palette.backgroundDark.hex, 0.03),
          border: `1px dashed ${hexToRgba(palette.backgroundDark.hex, 0.14)}`,
        }}>
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.5 }}>
            Manual entry — you can run NPI / PECOS verification any time from the physician&apos;s profile after saving.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Identity */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionLabel>Identity</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="First name" required>
              <Input value={form.first_name} onChange={set('first_name')} placeholder="First" autoFocus={!lookupMeta} />
            </Field>
            <Field label="Last name" required>
              <Input value={form.last_name} onChange={set('last_name')} placeholder="Last" />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Title / credential" hint="MD, NP, PA-C…">
              <Input value={form.title} onChange={set('title')} placeholder="e.g. NP" />
            </Field>
            <Field label="NPI" error={fieldErrors.npi}>
              <Input
                value={form.npi}
                onChange={(v) => { set('npi')(npiDigitsOf(v).slice(0, 10)); if (fieldErrors.npi) setFieldErrors((e) => ({ ...e, npi: '' })); }}
                placeholder="1234567890"
                inputMode="numeric"
                maxLength={10}
                hasError={!!fieldErrors.npi}
              />
            </Field>
          </div>
        </section>

        {/* Contact */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionLabel>Contact</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Phone" error={fieldErrors.phone}>
              <Input
                value={form.phone}
                onChange={(v) => { set('phone')(npiDigitsOf(v).slice(0, 10)); if (fieldErrors.phone) setFieldErrors((e) => ({ ...e, phone: '' })); }}
                type="tel"
                placeholder="(718) 555-1234"
                hasError={!!fieldErrors.phone}
              />
            </Field>
            <Field label="Fax" error={fieldErrors.fax}>
              <Input
                value={form.fax}
                onChange={(v) => { set('fax')(npiDigitsOf(v).slice(0, 10)); if (fieldErrors.fax) setFieldErrors((e) => ({ ...e, fax: '' })); }}
                type="tel"
                placeholder="(718) 555-5678"
                hasError={!!fieldErrors.fax}
              />
            </Field>
          </div>
        </section>

        {/* Address */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionLabel>Practice address</SectionLabel>
          <Field label="Street">
            <Input value={form.address_street} onChange={set('address_street')} placeholder="Street address" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 84px 110px', gap: 14 }}>
            <Field label="City">
              <Input value={form.address_city} onChange={set('address_city')} placeholder="City" />
            </Field>
            <Field label="State">
              <Input value={form.address_state} onChange={(v) => set('address_state')(v.toUpperCase().slice(0, 2))} placeholder="NY" maxLength={2} />
            </Field>
            <Field label="Zip" error={fieldErrors.address_zip}>
              <Input
                value={form.address_zip}
                onChange={(v) => {
                  const zip = npiDigitsOf(v).slice(0, 5);
                  if (fieldErrors.address_zip) setFieldErrors((e) => ({ ...e, address_zip: '' }));
                  const r = lookupZip(zip);
                  setForm((f) => ({
                    ...f,
                    address_zip: zip,
                    ...(r.valid && !f.address_city?.trim() ? { address_city: r.city } : {}),
                    ...(r.valid && !f.address_state?.trim() ? { address_state: r.state } : {}),
                  }));
                }}
                placeholder="11201"
                inputMode="numeric"
                maxLength={5}
                hasError={!!fieldErrors.address_zip}
              />
            </Field>
          </div>
        </section>

        {/* Enrollment */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SectionLabel>Medicare enrollment</SectionLabel>
          <div style={{ display: 'flex', gap: 12 }}>
            <EnrollToggle
              checked={form.is_pecos_enrolled}
              onChange={(v) => set('is_pecos_enrolled')(v)}
              label="PECOS enrolled"
              sub="In the Medicare ordering / referring file"
            />
            <EnrollToggle
              checked={form.is_opra_enrolled}
              onChange={(v) => set('is_opra_enrolled')(v)}
              label="OPRA eligible"
              sub="Eligible to order & refer services"
            />
          </div>
        </section>

        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: 9,
            background: hexToRgba(palette.primaryMagenta.hex, 0.06),
            border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.25)}`,
          }}>
            <p style={{ fontSize: 12.5, color: palette.primaryMagenta.hex }}>{error}</p>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: hexToRgba(palette.backgroundDark.hex, animated ? 0.45 : 0),
        backdropFilter: animated ? 'blur(3px)' : 'none',
        transition: 'background 0.2s, backdrop-filter 0.2s',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <style>{'@keyframes phy-spin { to { transform: rotate(360deg); } }'}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-physician-title"
        style={{
          background: palette.backgroundLight.hex, borderRadius: 16, width: '100%', maxWidth: 620,
          boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
          overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 48px)',
          transform: animated ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.97)',
          opacity: animated ? 1 : 0,
          transition: 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.22s',
        }}
      >
        {/* Header */}
        <div style={{ padding: '20px 26px 16px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
            <div>
              <h2 id="add-physician-title" style={{ fontSize: 17, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>
                Add Physician
              </h2>
              <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.5 }}>
                {step === 1
                  ? 'Look them up in the CMS registries to seed a complete, verified record.'
                  : 'Everything is editable — review, then save to the directory.'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              style={{
                width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                background: hexToRgba(palette.backgroundDark.hex, 0.05), border: 'none', cursor: 'pointer',
                color: hexToRgba(palette.backgroundDark.hex, 0.5),
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
          </div>
          <Steps step={step} />
        </div>

        {/* Body */}
        <div style={{ padding: '22px 26px 26px', overflowY: 'auto', flex: 1 }}>
          {step === 1 ? stepOne : stepTwo}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 26px', borderTop: '1px solid var(--color-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0,
          background: hexToRgba(palette.backgroundDark.hex, 0.015),
        }}>
          <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            <kbd style={{ fontSize: 10.5, padding: '1px 5px', borderRadius: 4, background: hexToRgba(palette.backgroundDark.hex, 0.06), fontFamily: 'inherit' }}>Esc</kbd> to close
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            {step === 2 && (
              <GhostButton onClick={backToSearch}>← Back to lookup</GhostButton>
            )}
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            {step === 2 && (
              <PrimaryButton onClick={handleSave} busy={saving} disabled={!form.first_name.trim() || !form.last_name.trim()}>
                {saving ? 'Saving' : 'Add Physician'}
              </PrimaryButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchHitRow({ hit, last, busy, disabled, onPick }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: '100%', textAlign: 'left', border: 'none',
        cursor: disabled ? 'wait' : 'pointer',
        padding: '11px 14px',
        background: hov && !disabled ? hexToRgba(palette.primaryDeepPlum.hex, 0.04) : '#fff',
        borderBottom: last ? 'none' : `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
        display: 'flex', alignItems: 'center', gap: 12,
        transition: 'background 0.1s',
        fontFamily: 'inherit',
        opacity: disabled && !busy ? 0.55 : 1,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hit.label}
        </p>
        <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          NPI {hit.npi}
          {hit.city ? ` · ${hit.city}${hit.state ? `, ${hit.state}` : ''}` : ''}
          {hit.taxonomy ? ` · ${hit.taxonomy}` : ''}
        </p>
      </div>
      {busy ? (
        <Spinner />
      ) : (
        <span style={{
          fontSize: 11.5, fontWeight: 650, flexShrink: 0,
          color: hov ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.35),
          display: 'inline-flex', alignItems: 'center', gap: 4,
          transition: 'color 0.1s',
        }}>
          Use
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </span>
      )}
    </button>
  );
}

function EnrollToggle({ checked, onChange, label, sub }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        flex: 1, textAlign: 'left', padding: '12px 14px', borderRadius: 10,
        border: `1px solid ${checked ? hexToRgba(palette.accentGreen.hex, 0.5) : hexToRgba(palette.backgroundDark.hex, 0.12)}`,
        background: checked
          ? hexToRgba(palette.accentGreen.hex, 0.07)
          : hov ? hexToRgba(palette.backgroundDark.hex, 0.03) : '#fff',
        cursor: 'pointer', fontFamily: 'inherit',
        display: 'flex', alignItems: 'flex-start', gap: 10,
        transition: 'all 0.12s',
      }}
    >
      <span style={{
        width: 17, height: 17, borderRadius: 5, flexShrink: 0, marginTop: 1,
        border: `1.5px solid ${checked ? '#2e7d52' : hexToRgba(palette.backgroundDark.hex, 0.3)}`,
        background: checked ? '#2e7d52' : '#fff',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', transition: 'all 0.12s',
      }}>
        {checked && (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        )}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), lineHeight: 1.4 }}>{sub}</span>
      </span>
    </button>
  );
}
