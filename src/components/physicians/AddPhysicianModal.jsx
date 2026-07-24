import { useState } from 'react';
import { createPhysician } from '../../api/physicians.js';
import { buildPhysicianSeedFromNpi, searchNpiProviders } from '../../api/cms.js';
import { clearLookupsCache } from '../../hooks/useLookups.js';
import { refreshPhysicians } from '../../hooks/usePhysicians.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { SmartNpiInput } from '../common/SmartFields.jsx';
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

const BASE_INPUT = {
  width: '100%', padding: '7px 10px', borderRadius: 6,
  border: '1px solid var(--color-border)',
  background: hexToRgba(palette.backgroundDark.hex, 0.03),
  fontSize: 13, color: palette.backgroundDark.hex,
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
};

function TInput({ value, onChange, placeholder, type = 'text', autoFocus, maxLength, disabled }) {
  return (
    <input
      type={type}
      value={value || ''}
      placeholder={placeholder}
      autoFocus={autoFocus}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      maxLength={maxLength}
      style={{ ...BASE_INPUT, opacity: disabled ? 0.6 : 1, cursor: disabled ? 'not-allowed' : 'text' }}
      onFocus={(e) => { if (!disabled) e.target.style.borderColor = palette.primaryMagenta.hex; }}
      onBlur={(e) => { e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.15); }}
    />
  );
}

function FG({ label, required, hint, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 4 }}>
        {label}{required && <span style={{ color: palette.primaryMagenta.hex }}> *</span>}
      </label>
      {children}
      {hint && (
        <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 3, lineHeight: 1.35 }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function Pill({ ok, label }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 650, padding: '2px 8px', borderRadius: 10,
      background: ok ? hexToRgba(palette.accentGreen.hex, 0.14) : hexToRgba(palette.backgroundDark.hex, 0.07),
      color: ok ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.45),
    }}>
      {label} {ok ? '✓' : '—'}
    </span>
  );
}

/**
 * Directory create modal with CMS seed wizard (NPI lookup or NPPES name search).
 */
export default function AddPhysicianModal({ onClose, onAdded }) {
  const { appUserId } = useCurrentAppUser();
  const [form, setForm] = useState(EMPTY_FORM);
  const [verification, setVerification] = useState(null);
  const [lookupMeta, setLookupMeta] = useState(null);
  const [wizardNpi, setWizardNpi] = useState('');
  const [searchFirst, setSearchFirst] = useState('');
  const [searchLast, setSearchLast] = useState('');
  const [searchState, setSearchState] = useState('NY');
  const [searchHits, setSearchHits] = useState([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [searching, setSearching] = useState(false);
  const [wizardError, setWizardError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  async function applySeedFromNpi(npi) {
    const clean = String(npi || '').replace(/\D/g, '');
    if (clean.length !== 10) {
      setWizardError('Enter a valid 10-digit NPI to look up.');
      return;
    }
    setLookingUp(true);
    setWizardError('');
    setSearchHits([]);
    try {
      const seed = await buildPhysicianSeedFromNpi(clean);
      setForm((f) => ({ ...f, ...seed.form }));
      setVerification(seed.verification);
      setLookupMeta(seed.meta);
      setWizardNpi(clean);
    } catch (e) {
      setWizardError(e.message || 'CMS lookup failed.');
      setLookupMeta(null);
      setVerification(null);
    } finally {
      setLookingUp(false);
    }
  }

  async function handleNameSearch() {
    setSearching(true);
    setWizardError('');
    setSearchHits([]);
    try {
      const hits = await searchNpiProviders({
        firstName: searchFirst,
        lastName: searchLast,
        state: searchState,
      });
      if (!hits.length) {
        setWizardError('No NPPES matches. Try a different spelling, or look up by NPI.');
      }
      setSearchHits(hits);
    } catch (e) {
      setWizardError(e.message || 'NPPES search failed.');
    } finally {
      setSearching(false);
    }
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
    const npiDigits = String(form.npi || '').replace(/\D/g, '');
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
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: hexToRgba(palette.backgroundDark.hex, 0.5),
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div style={{
        background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 600,
        boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
        overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 48px)',
      }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex }}>Add Physician</p>
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 2 }}>
              Look up NPPES / PECOS first to seed a complete record, then tweak anything before saving.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: hexToRgba(palette.backgroundDark.hex, 0.4), padding: '2px 6px' }}>×</button>
        </div>

        <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto', flex: 1 }}>
          {/* ── CMS wizard ── */}
          <section style={{
            padding: '14px 14px 12px', borderRadius: 10,
            background: hexToRgba(palette.accentBlue.hex, 0.05),
            border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.22)}`,
          }}>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: palette.accentBlue.hex, marginBottom: 10 }}>
              CMS lookup wizard
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end', marginBottom: 12 }}>
              <FG label="NPI number" hint="Fastest path — pulls name, title, address, phone, fax, PECOS & OPRA.">
                <SmartNpiInput value={wizardNpi} onChange={setWizardNpi} />
              </FG>
              <button
                type="button"
                onClick={() => applySeedFromNpi(wizardNpi)}
                disabled={lookingUp || String(wizardNpi).replace(/\D/g, '').length !== 10}
                style={{
                  height: 34, padding: '0 14px', borderRadius: 7, border: 'none',
                  background: lookingUp ? hexToRgba(palette.backgroundDark.hex, 0.12) : palette.accentBlue.hex,
                  color: '#fff', fontSize: 12.5, fontWeight: 650,
                  cursor: lookingUp ? 'wait' : 'pointer', whiteSpace: 'nowrap', marginBottom: 1,
                }}
              >
                {lookingUp ? 'Looking up…' : 'Look up NPI'}
              </button>
            </div>

            <div style={{ height: 1, background: hexToRgba(palette.backgroundDark.hex, 0.08), margin: '4px 0 12px' }} />

            <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginBottom: 8 }}>
              Don&apos;t have the NPI? Search NPPES by name, then click a match to fill the form.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 72px auto', gap: 8, alignItems: 'end' }}>
              <FG label="First name">
                <TInput value={searchFirst} onChange={setSearchFirst} placeholder="Optional" />
              </FG>
              <FG label="Last name">
                <TInput value={searchLast} onChange={setSearchLast} placeholder="Required" />
              </FG>
              <FG label="State">
                <TInput value={searchState} onChange={(v) => setSearchState(v.toUpperCase().slice(0, 2))} placeholder="NY" maxLength={2} />
              </FG>
              <button
                type="button"
                onClick={handleNameSearch}
                disabled={searching || searchLast.trim().length < 2}
                style={{
                  height: 34, padding: '0 12px', borderRadius: 7,
                  border: `1px solid ${hexToRgba(palette.accentBlue.hex, 0.35)}`,
                  background: '#fff', color: palette.accentBlue.hex,
                  fontSize: 12.5, fontWeight: 650, cursor: searching ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>

            {wizardError && (
              <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginTop: 10 }}>{wizardError}</p>
            )}

            {searchHits.length > 0 && (
              <div style={{
                marginTop: 10, borderRadius: 8, border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.1)}`,
                background: '#fff', maxHeight: 180, overflowY: 'auto',
              }}>
                {searchHits.map((hit) => (
                  <button
                    key={hit.npi}
                    type="button"
                    onClick={() => applySeedFromNpi(hit.npi)}
                    disabled={lookingUp}
                    style={{
                      width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                      padding: '9px 11px', background: 'transparent',
                      borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
                      display: 'block',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = hexToRgba(palette.accentBlue.hex, 0.06); }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex }}>
                      {hit.label}
                    </span>
                    <span style={{ display: 'block', fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginTop: 2 }}>
                      NPI {hit.npi}
                      {hit.city ? ` · ${hit.city}${hit.state ? `, ${hit.state}` : ''}` : ''}
                      {hit.taxonomy ? ` · ${hit.taxonomy}` : ''}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {lookupMeta && (
              <div style={{
                marginTop: 12, padding: '10px 12px', borderRadius: 8,
                background: hexToRgba(palette.accentGreen.hex, 0.08),
                border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.25)}`,
              }}>
                <p style={{ fontSize: 12.5, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 6 }}>
                  Loaded from CMS
                  {lookupMeta.providerName ? `: ${lookupMeta.providerName}` : ''}
                  {form.title ? `, ${form.title}` : ''}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: lookupMeta.taxonomy ? 6 : 0 }}>
                  <Pill ok={lookupMeta.npiStatus === 'active'} label={`NPI ${lookupMeta.npiStatus || '—'}`} />
                  <Pill ok={lookupMeta.pecosEnrolled} label="PECOS" />
                  <Pill ok={lookupMeta.opraEligible} label="OPRA" />
                </div>
                {lookupMeta.taxonomy && (
                  <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.55) }}>
                    {lookupMeta.taxonomy}
                  </p>
                )}
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 6 }}>
                  Review the fields below — you can edit anything before saving.
                </p>
              </div>
            )}
          </section>

          {/* ── Editable fields ── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FG label="First Name" required>
              <TInput value={form.first_name} onChange={set('first_name')} placeholder="First" autoFocus={!lookupMeta} />
            </FG>
            <FG label="Last Name" required>
              <TInput value={form.last_name} onChange={set('last_name')} placeholder="Last" />
            </FG>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <FG label="Title / credential" hint="From NPPES (MD, NP, PA-C…)">
              <TInput value={form.title} onChange={set('title')} placeholder="NP" />
            </FG>
            <FG label="NPI">
              <SmartNpiInput value={form.npi} onChange={set('npi')} />
              {fieldErrors.npi && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 2 }}>{fieldErrors.npi}</p>}
            </FG>
            <FG label="Phone">
              <TInput
                value={form.phone}
                onChange={(v) => { set('phone')(v.replace(/\D/g, '').slice(0, 10)); if (fieldErrors.phone) setFieldErrors((e) => ({ ...e, phone: '' })); }}
                type="tel"
                placeholder="(718) 555-1234"
              />
              {fieldErrors.phone && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 2 }}>{fieldErrors.phone}</p>}
            </FG>
          </div>
          <FG label="Fax">
            <TInput
              value={form.fax}
              onChange={(v) => { set('fax')(v.replace(/\D/g, '').slice(0, 10)); if (fieldErrors.fax) setFieldErrors((e) => ({ ...e, fax: '' })); }}
              type="tel"
              placeholder="(718) 555-5678"
            />
            {fieldErrors.fax && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 2 }}>{fieldErrors.fax}</p>}
          </FG>
          <FG label="Address">
            <TInput value={form.address_street} onChange={set('address_street')} placeholder="Street address" />
          </FG>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <FG label="City"><TInput value={form.address_city} onChange={set('address_city')} placeholder="City" /></FG>
            <FG label="State"><TInput value={form.address_state} onChange={set('address_state')} placeholder="NY" maxLength={2} /></FG>
            <FG label="Zip">
              <TInput
                value={form.address_zip}
                onChange={(v) => {
                  const zip = v.replace(/\D/g, '').slice(0, 5);
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
                maxLength={5}
              />
              {fieldErrors.address_zip && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 2 }}>{fieldErrors.address_zip}</p>}
            </FG>
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.is_pecos_enrolled}
                onChange={(e) => set('is_pecos_enrolled')(e.target.checked)}
                style={{ accentColor: palette.accentGreen.hex, width: 14, height: 14 }}
              />
              PECOS enrolled
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={form.is_opra_enrolled}
                onChange={(e) => set('is_opra_enrolled')(e.target.checked)}
                style={{ accentColor: palette.accentGreen.hex, width: 14, height: 14 }}
              />
              OPRA enrolled
            </label>
          </div>
          {error && <p style={{ fontSize: 12.5, color: palette.primaryMagenta.hex }}>{error}</p>}
        </div>

        <div style={{ padding: '14px 22px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '7px 18px', borderRadius: 7, border: '1px solid var(--color-border)',
              background: 'none', fontSize: 13, fontWeight: 550,
              color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '7px 20px', borderRadius: 7, background: palette.primaryDeepPlum.hex,
              border: 'none', fontSize: 13, fontWeight: 650, color: '#fff',
              cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Add Physician'}
          </button>
        </div>
      </div>
    </div>
  );
}
