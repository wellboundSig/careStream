import { useState, useEffect, useMemo, useRef } from 'react';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import { useIsMobile } from '../../hooks/useIsMobile.js';
import { createPatient } from '../../api/patients.js';
import { createReferral, updateReferral } from '../../api/referrals.js';
import { createNote } from '../../api/notes.js';
import { useCareStore, mergeEntities } from '../../store/careStore.js';
import PhysicianPicker from '../physicians/PhysicianPicker.jsx';
import { agencies } from '../../../agencies.js';
import palette, { hexToRgba } from '../../utils/colors.js';
import { normalizePhone, validateEmail, lookupZip } from '../../utils/validation.js';

const DIVISIONS = ['ALF', 'Special Needs'];
const GENDERS = ['Male', 'Female', 'Other', 'Prefer Not to Say'];

const ALF_SERVICES = ['SN', 'PT', 'OT', 'ST', 'HHA'];
const SPN_SERVICES = ['SN', 'PT', 'OT', 'ST', 'HHA', 'ABA'];

const INSURANCE_PLANS = [
  'Fidelis Care',
  'UnitedHealthcare Community Plan',
  'Healthfirst',
  'Aetna Better Health',
  'Molina Healthcare',
  'Anthem BCBS',
  'Medicaid',
  'Medicare',
  'Hamaspik',
  'VNS Health',
  'MetroPlus MLTC',
  'Fidelis Care at Home',
  'Elderplan HomeFirst',
  'Montefiore Diamond Care',
  'Healthfirst CompleteCare',
];

// ── Licence mapping from agencies.js ────────────────────────────────────────
const WB_AGENCY = agencies.find((a) => a.name === 'Wellbound');
const WBII_AGENCY = agencies.find((a) => a.name === 'Wellbound II, LLC');
const WB_COUNTIES = new Set(WB_AGENCY?.countiesServed || []);
const WBII_COUNTIES = new Set(WBII_AGENCY?.countiesServed || []);
const ALL_COUNTIES = [...new Set([...(WB_AGENCY?.countiesServed || []), ...(WBII_AGENCY?.countiesServed || [])])].sort();

export function getLicenceForCounty(county) {
  if (!county) return null;
  const inWB = WB_COUNTIES.has(county);
  const inWBII = WBII_COUNTIES.has(county);
  if (inWB && inWBII) return 'both';
  if (inWB) return 'WB';
  if (inWBII) return 'WBII';
  return null;
}

export function getServicesForDivision(division) {
  return division === 'Special Needs' ? SPN_SERVICES : ALF_SERVICES;
}

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ── Shared field components ───────────────────────────────────────────────────

function Label({ children, required }) {
  return (
    <label style={{ display: 'block', fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 5, letterSpacing: '0.02em' }}>
      {children}
      {required && <span style={{ color: palette.primaryMagenta.hex, marginLeft: 3 }}>*</span>}
    </label>
  );
}

const inputBase = {
  width: '100%', padding: '9px 11px', borderRadius: 8,
  border: 'none',
  background: hexToRgba(palette.backgroundDark.hex, 0.05),
  fontSize: 13, color: palette.backgroundDark.hex,
  outline: 'none', fontFamily: 'inherit', transition: 'box-shadow 0.15s',
  boxSizing: 'border-box',
};

function Input({ value, onChange, placeholder, type = 'text', hasError }) {
  return (
    <input
      type={type}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...inputBase, boxShadow: hasError ? `0 0 0 1.5px ${palette.primaryMagenta.hex}` : 'none' }}
      onFocus={(e) => (e.target.style.boxShadow = `0 0 0 1.5px ${palette.primaryMagenta.hex}`)}
      onBlur={(e) => (e.target.style.boxShadow = hasError ? `0 0 0 1.5px ${palette.primaryMagenta.hex}` : 'none')}
    />
  );
}

function Select({ value, onChange, options, placeholder, hasError, disabled }) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{ ...inputBase, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, boxShadow: hasError ? `0 0 0 1.5px ${palette.primaryMagenta.hex}` : 'none' }}
      onFocus={(e) => (e.target.style.boxShadow = `0 0 0 1.5px ${palette.primaryMagenta.hex}`)}
      onBlur={(e) => (e.target.style.boxShadow = hasError ? `0 0 0 1.5px ${palette.primaryMagenta.hex}` : 'none')}
    >
      <option value="" disabled>{placeholder || 'Select...'}</option>
      {options.map((opt) => (
        <option key={typeof opt === 'string' ? opt : opt.value} value={typeof opt === 'string' ? opt : opt.value}>
          {typeof opt === 'string' ? opt : opt.label}
        </option>
      ))}
    </select>
  );
}

function FieldGroup({ children, cols = 2 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(var(--form-cols, ${cols}), 1fr)`, gap: '12px 16px' }}>
      {children}
    </div>
  );
}

function FieldBox({ label, required, children, fullWidth }) {
  return (
    <div style={{ gridColumn: fullWidth ? '1 / -1' : undefined }}>
      <Label required={required}>{label}</Label>
      {children}
    </div>
  );
}

function SectionDivider({ title, expanded, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: '100%', padding: '14px 0 6px', background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 8, color: hexToRgba(palette.backgroundDark.hex, 0.45),
        fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      }}
    >
      {title}
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
        <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function CheckboxGroup({ options, values, onChange }) {
  function toggle(opt) {
    const arr = values || [];
    onChange(arr.includes(opt) ? arr.filter((v) => v !== opt) : [...arr, opt]);
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
      {options.map((opt) => (
        <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={(values || []).includes(opt)} onChange={() => toggle(opt)} style={{ accentColor: palette.primaryMagenta.hex, width: 14, height: 14 }} />
          {opt}
        </label>
      ))}
    </div>
  );
}

// ── Multi-select insurance with checkmarks ──────────────────────────────────

function InsuranceMultiSelect({ selected, onChange, planDetails, onPlanDetailChange }) {
  const [open, setOpen] = useState(false);
  const [otherValue, setOtherValue] = useState('');
  const [showOther, setShowOther] = useState(false);
  const dropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function dismiss(e) { if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', dismiss);
    return () => document.removeEventListener('mousedown', dismiss);
  }, [open]);

  function togglePlan(plan) {
    if (selected.includes(plan)) {
      onChange(selected.filter((p) => p !== plan));
    } else {
      onChange([...selected, plan]);
    }
  }

  function removePlan(plan) {
    onChange(selected.filter((p) => p !== plan));
  }

  function addOther() {
    if (!otherValue.trim()) return;
    const label = otherValue.trim();
    if (!selected.includes(label)) onChange([...selected, label]);
    setOtherValue('');
    setShowOther(false);
  }

  const unselected = INSURANCE_PLANS.filter((p) => !selected.includes(p));

  return (
    <div>
      {/* Dropdown trigger */}
      <div ref={dropRef} style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            ...inputBase, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', textAlign: 'left',
            color: selected.length > 0 ? palette.backgroundDark.hex : hexToRgba(palette.backgroundDark.hex, 0.4),
          }}
        >
          <span>{selected.length > 0 ? `${selected.length} plan${selected.length !== 1 ? 's' : ''} selected` : 'Select insurance plans...'}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100,
            maxHeight: 220, overflowY: 'auto', borderRadius: 10,
            background: palette.backgroundLight.hex,
            boxShadow: `0 8px 28px ${hexToRgba(palette.backgroundDark.hex, 0.14)}`,
            padding: '4px 0',
          }}>
            {INSURANCE_PLANS.map((plan) => {
              const isSelected = selected.includes(plan);
              return (
                <button key={plan} type="button" onClick={() => togglePlan(plan)} style={{
                  width: '100%', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 9,
                  background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                  fontSize: 12.5, color: palette.backgroundDark.hex, transition: 'background 0.08s',
                }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.04))}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                >
                  <span style={{
                    width: 14, height: 14, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: isSelected ? palette.primaryMagenta.hex : 'none',
                    border: isSelected ? 'none' : `1.5px solid ${hexToRgba(palette.backgroundDark.hex, 0.2)}`,
                  }}>
                    {isSelected && (
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2.5 2.5L8 3" stroke={palette.backgroundLight.hex} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {plan}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Tags */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
          {selected.map((plan) => (
            <span key={plan} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '4px 8px', borderRadius: 4,
              background: hexToRgba(palette.backgroundDark.hex, 0.06),
              fontSize: 11.5, fontWeight: 550, color: palette.backgroundDark.hex,
            }}>
              {plan}
              <button type="button" onClick={() => removePlan(plan)} style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                color: hexToRgba(palette.backgroundDark.hex, 0.35), display: 'flex', alignItems: 'center',
              }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Other */}
      {!showOther ? (
        <button type="button" onClick={() => setShowOther(true)} style={{ marginTop: 6, background: 'none', border: 'none', fontSize: 11.5, fontWeight: 600, color: palette.primaryMagenta.hex, cursor: 'pointer', padding: '4px 0' }}>
          + Other
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input
            value={otherValue}
            onChange={(e) => setOtherValue(e.target.value)}
            placeholder="Insurance name"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addOther())}
            style={{ ...inputBase, flex: 1, fontSize: 12 }}
          />
          <button type="button" onClick={addOther} disabled={!otherValue.trim()} style={{
            padding: '6px 14px', borderRadius: 7, border: 'none', fontSize: 12, fontWeight: 650, cursor: otherValue.trim() ? 'pointer' : 'not-allowed',
            background: otherValue.trim() ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.08),
            color: otherValue.trim() ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3),
          }}>Add</button>
        </div>
      )}

      {/* Plan detail inputs */}
      {selected.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {selected.map((plan) => (
            <div key={plan} style={{ marginBottom: 6 }}>
              <input
                value={planDetails[plan] || ''}
                onChange={(e) => onPlanDetailChange(plan, e.target.value)}
                placeholder={`${plan} member ID or plan #`}
                style={{ ...inputBase, fontSize: 12 }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main form ─────────────────────────────────────────────────────────────────

export default function NewReferralForm({ onClose, onSuccess }) {
  const { appUser, appUserId } = useCurrentAppUser();
  const { can } = usePermissions();
  const isMobile = useIsMobile();

  if (!can(PERMISSION_KEYS.REFERRAL_CREATE)) {
    return (
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9990, background: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: palette.backgroundLight.hex, borderRadius: 16, padding: '40px 32px', textAlign: 'center', maxWidth: 380 }}>
          <p style={{ fontSize: 15, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 8 }}>Permission Required</p>
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>You do not have permission to create referrals. Contact your administrator.</p>
          <button onClick={onClose} style={{ marginTop: 16, padding: '8px 20px', borderRadius: 8, background: palette.primaryMagenta.hex, border: 'none', fontSize: 13, fontWeight: 600, color: palette.backgroundLight.hex, cursor: 'pointer' }}>Close</button>
        </div>
      </div>
    );
  }

  const storeMarketers      = useCareStore((s) => s.marketers);
  const storeSources        = useCareStore((s) => s.referralSources);
  const storeRoles          = useCareStore((s) => s.roles);
  const storeFacilities     = useCareStore((s) => s.facilities);
  const storeMarketerFacs   = useCareStore((s) => s.marketerFacilities);
  const marketers = useMemo(() => Object.values(storeMarketers), [storeMarketers]);
  const sources   = useMemo(() => Object.values(storeSources),   [storeSources]);

  const currentMarketer = useMemo(() => {
    if (!appUserId || !marketers.length) return null;
    return marketers.find((m) => m.user_id === appUserId) || null;
  }, [appUserId, marketers]);

  const isMarketerRole = useMemo(() => {
    if (!appUser?.role_id) return false;
    const role = Object.values(storeRoles).find((r) => r.id === appUser.role_id);
    return /market/i.test(role?.name || '');
  }, [appUser?.role_id, storeRoles]);

  const allowedDivisions = useMemo(() => {
    if (!isMarketerRole || !currentMarketer) return DIVISIONS;
    const md = currentMarketer.division;
    if (md === 'ALF') return ['ALF'];
    if (md === 'Special Needs') return ['Special Needs'];
    if (md === 'Both') return ['ALF', 'Special Needs'];
    return DIVISIONS;
  }, [isMarketerRole, currentMarketer]);

  const divisionLocked = allowedDivisions.length === 1;

  const storeNetFacs = useCareStore((s) => s.networkFacilities);
  const availableFacilities = useMemo(() => {
    return Object.values(storeNetFacs || {}).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [storeNetFacs]);

  const [showPatientDetails, setShowPatientDetails] = useState(false);
  const [showReferralDetails, setShowReferralDetails] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [errors, setErrors] = useState({});
  const [selectedPhysician, setSelectedPhysician] = useState(null);

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    phone_primary: '',
    referral_source_id: '',
    referral_source_other: '',
    marketer_id: '',
    marketer_other: '',
    dob: '',
    gender: '',
    phone_secondary: '',
    email: '',
    medicaid_number: '',
    medicare_number: '',
    insurance_id: '',
    address_street: '',
    address_city: '',
    address_state: 'NY',
    address_zip: '',
    division: '',
    facility_id: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    services_requested: [],
    initial_notes: '',
    // Multi-insurance
    insurance_plans: [],
    insurance_plan_details: {},
    // Special Needs specifics
    sn_age_group: '',
    county: '',
    services_under_licence: '',
    code_95: '',
  });

  function setField(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'division') {
        if (value !== 'ALF') next.facility_id = '';
        if (value !== 'Special Needs') {
          next.sn_age_group = '';
          next.county = '';
          next.services_under_licence = '';
          next.code_95 = '';
        }
        next.services_requested = [];
        if (value !== 'ALF') next.marketer_id = '';
      }
      if (key === 'county') {
        const lic = getLicenceForCounty(value);
        if (lic === 'WB' || lic === 'WBII') {
          next.services_under_licence = lic;
        } else if (lic === 'both') {
          next.services_under_licence = '';
        } else {
          next.services_under_licence = '';
        }
      }
      if (key === 'facility_id' && value) {
        const links = Object.values(storeMarketerFacs).filter(
          (mf) => mf.facility_id === value
        );
        const primary = links.find(
          (l) => l.is_primary === true || l.is_primary === 'true'
        );
        if (primary) {
          next.marketer_id = primary.marketer_id;
        } else if (links.length === 1) {
          next.marketer_id = links[0].marketer_id;
        } else if (links.length === 0) {
          next.marketer_id = prev.marketer_id;
        }
      }
      if (key === 'facility_id' && !value) {
        next.marketer_id = '';
      }
      return next;
    });
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: null }));
  }

  function setInsurancePlans(plans) {
    setForm((prev) => ({ ...prev, insurance_plans: plans }));
  }

  function setInsurancePlanDetail(plan, value) {
    setForm((prev) => ({
      ...prev,
      insurance_plan_details: { ...prev.insurance_plan_details, [plan]: value },
    }));
  }

  useEffect(() => {
    if (!appUserId || !marketers.length) return;
    const match = marketers.find((m) => m.user_id === appUserId);
    if (match) setField('marketer_id', match.id);
  }, [appUserId, marketers]);

  useEffect(() => {
    if (divisionLocked && form.division !== allowedDivisions[0]) {
      setField('division', allowedDivisions[0]);
    }
  }, [divisionLocked, allowedDivisions]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const countyLicence = getLicenceForCounty(form.county);
  const needsLicenceChoice = countyLicence === 'both' && !form.services_under_licence;

  function validate() {
    const errs = {};
    if (!form.first_name.trim()) errs.first_name = 'Required';
    if (!form.last_name.trim()) errs.last_name = 'Required';
    if (!form.phone_primary.trim()) {
      errs.phone_primary = 'Required';
    } else {
      const phoneResult = normalizePhone(form.phone_primary);
      if (!phoneResult.valid) errs.phone_primary = phoneResult.error;
    }
    if (form.email && form.email.trim()) {
      const emailResult = validateEmail(form.email);
      if (!emailResult.valid) errs.email = emailResult.error;
    }
    if (form.address_zip && form.address_zip.trim()) {
      const zipResult = lookupZip(form.address_zip);
      if (!zipResult.valid) errs.address_zip = zipResult.error;
    }
    if (!form.division) errs.division = 'Required';
    if (!form.referral_source_id) errs.referral_source_id = 'Required';
    if (form.referral_source_id === 'other' && !form.referral_source_other.trim()) errs.referral_source_other = 'Required';
    if (!form.marketer_id) errs.marketer_id = 'Required';
    if (form.marketer_id === 'other' && !form.marketer_other.trim()) errs.marketer_other = 'Required';
    if (form.division === 'ALF' && !form.facility_id) errs.facility_id = 'Required for ALF referrals';
    if (form.division === 'Special Needs') {
      if (!form.sn_age_group) errs.sn_age_group = 'Required for Special Needs';
      if (!form.county) errs.county = 'Required for Special Needs';
      if (countyLicence === 'both' && !form.services_under_licence) errs.services_under_licence = 'Choose WB or WBII for this county';
    }
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    const primaryNorm = normalizePhone(form.phone_primary);
    if (primaryNorm.valid) form.phone_primary = primaryNorm.digits;

    if (form.phone_secondary) {
      const secNorm = normalizePhone(form.phone_secondary);
      if (secNorm.valid) form.phone_secondary = secNorm.digits;
    }
    if (form.emergency_contact_phone) {
      const ecNorm = normalizePhone(form.emergency_contact_phone);
      if (ecNorm.valid) form.emergency_contact_phone = ecNorm.digits;
    }

    if (form.address_zip && form.address_zip.trim()) {
      const zipInfo = lookupZip(form.address_zip);
      if (zipInfo.valid) {
        if (!form.address_city) form.address_city = zipInfo.city;
        if (!form.address_state) form.address_state = zipInfo.state;
      }
    }

    setSubmitting(true);
    setError(null);

    try {
      const patientCustomId = generateId('pat');
      const referralCustomId = generateId('ref');

      const insurancePrimary = form.insurance_plans[0] || '';
      const allInsuranceJson = form.insurance_plans.length > 0 ? JSON.stringify(form.insurance_plans) : '';
      const planDetailsJson = Object.keys(form.insurance_plan_details).length > 0 ? JSON.stringify(form.insurance_plan_details) : '';

      const patientFields = {
        id: patientCustomId,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone_primary: form.phone_primary.trim(),
        insurance_plan: insurancePrimary,
        division: form.division,
        is_active: 'TRUE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(allInsuranceJson && { insurance_plans: allInsuranceJson }),
        ...(planDetailsJson && { insurance_plan_details: planDetailsJson }),
        ...(form.county && { county: form.county }),
        ...(form.dob && { dob: form.dob }),
        ...(form.gender && { gender: form.gender }),
        ...(form.phone_secondary && { phone_secondary: form.phone_secondary }),
        ...(form.email && { email: form.email }),
        ...(form.medicaid_number && { medicaid_number: form.medicaid_number }),
        ...(form.medicare_number && { medicare_number: form.medicare_number }),
        ...(form.insurance_id && { insurance_id: form.insurance_id }),
        ...(form.address_street && { address_street: form.address_street }),
        ...(form.address_city && { address_city: form.address_city }),
        ...(form.address_state && { address_state: form.address_state }),
        ...(form.address_zip && { address_zip: form.address_zip }),
        ...(form.emergency_contact_name && { emergency_contact_name: form.emergency_contact_name }),
        ...(form.emergency_contact_phone && { emergency_contact_phone: form.emergency_contact_phone }),
      };

      const patientRecord = await createPatient(patientFields);
      const createdPatientId = patientRecord.fields?.id || patientCustomId;

      const resolvedMarketer = form.marketer_id === 'other'
        ? form.marketer_other.trim()
        : form.marketer_id;

      const resolvedSource = form.referral_source_id === 'other'
        ? form.referral_source_other.trim()
        : form.referral_source_id;

      const referralDate = new Date().toISOString();
      const referralFields = {
        id: referralCustomId,
        patient_id: createdPatientId,
        marketer_id: resolvedMarketer,
        referral_source_id: resolvedSource,
        current_stage: (form.division === 'Special Needs' && form.code_95 === 'no') ? 'OPWDD Enrollment' : 'Lead Entry',
        division: form.division,
        priority: 'Normal',
        referral_date: referralDate,
        created_at: referralDate,
        updated_at: referralDate,
        ...(form.services_requested.length && { services_requested: form.services_requested }),
        ...(form.facility_id && { facility_id: form.facility_id }),
        ...(appUserId && { intake_owner_id: appUserId }),
        ...(selectedPhysician?.id && { physician_id: selectedPhysician.id }),
        ...(form.sn_age_group && { sn_age_group: form.sn_age_group }),
        ...(form.services_under_licence && { services_under_licence: form.services_under_licence }),
        ...(form.code_95 && { code_95: form.code_95 }),
      };

      const referralRecord = await createReferral(referralFields);

      mergeEntities('patients', { [patientRecord.id]: { _id: patientRecord.id, ...patientRecord.fields } });
      mergeEntities('referrals', { [referralRecord.id]: { _id: referralRecord.id, ...referralRecord.fields } });

      if (referralRecord?._id) {
        updateReferral(referralRecord._id, { stage_entered_at: referralDate }).catch(() => {});
      }

      if (form.initial_notes?.trim()) {
        createNote({
          id: `note_${Date.now()}`,
          patient_id: createdPatientId,
          referral_id: referralCustomId,
          author_id: appUserId || 'unknown',
          content: form.initial_notes.trim(),
          is_pinned: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).catch(() => {});
      }

      onSuccess?.({
        patient: { _id: patientRecord.id, ...patientRecord.fields },
        referral: { _id: referralRecord.id, ...referralRecord.fields },
      });
      onClose();
    } catch (err) {
      console.error('[NewReferralForm] Submission failed:', err);
      setError(`Submission failed: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  const facilityMarketerLinks = useMemo(() => {
    if (!form.facility_id || form.division !== 'ALF') return null;
    const links = Object.values(storeMarketerFacs).filter(
      (mf) => mf.facility_id === form.facility_id
    );
    if (links.length === 0) return null;
    return links;
  }, [form.facility_id, form.division, storeMarketerFacs]);

  const marketerOptions = useMemo(() => {
    if (facilityMarketerLinks) {
      const linked = facilityMarketerLinks
        .map((link) => {
          const m = marketers.find((mk) => mk.id === link.marketer_id);
          if (!m) return null;
          const isPrimary = link.is_primary === true || link.is_primary === 'true';
          return {
            value: m.id,
            label: `${m.first_name} ${m.last_name}${isPrimary ? '  ★ Primary' : ''}`,
            isPrimary,
          };
        })
        .filter(Boolean)
        .sort((a, b) => (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0));
      return [...linked, { value: 'other', label: 'Other / Not listed' }];
    }
    return [
      ...marketers.map((m) => ({ value: m.id, label: `${m.first_name} ${m.last_name}` })),
      { value: 'other', label: 'Other / Not listed' },
    ];
  }, [facilityMarketerLinks, marketers]);

  const sourceOptions = [
    ...sources.map((s) => ({ value: s.id, label: s.name })),
    { value: 'other', label: 'Other' },
  ];

  const servicesForDivision = getServicesForDivision(form.division);

  return (
    <div
      onClick={(e) => !isMobile && e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9990,
        background: isMobile ? 'transparent' : hexToRgba(palette.backgroundDark.hex, 0.5),
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 24,
      }}
    >
      <div style={{
        background: palette.backgroundLight.hex,
        borderRadius: isMobile ? '16px 16px 0 0' : 16,
        width: '100%',
        maxWidth: isMobile ? '100%' : 680,
        maxHeight: isMobile ? '95vh' : '90vh',
        height: isMobile ? '95vh' : undefined,
        display: 'flex', flexDirection: 'column',
        boxShadow: `0 -4px 40px ${hexToRgba(palette.backgroundDark.hex, 0.2)}`,
        overflow: 'hidden',
        '--form-cols': isMobile ? '1' : undefined,
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', flexShrink: 0, background: palette.primaryDeepPlum.hex }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundLight.hex, marginBottom: 3 }}>New Referral</h2>
              <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundLight.hex, 0.55) }}>
                Creates a patient record and initiates a Leads referral
              </p>
            </div>
            <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, background: hexToRgba(palette.backgroundLight.hex, 0.1), border: 'none', color: hexToRgba(palette.backgroundLight.hex, 0.7), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M1 1l11 11M12 1L1 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Form body */}
        <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ── 1. DIVISION ── */}
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 10 }}>
              Division <span style={{ color: palette.primaryMagenta.hex }}>*</span>
            </p>
            <Select
              value={form.division}
              onChange={(v) => !divisionLocked && setField('division', v)}
              options={allowedDivisions.map((d) => ({ value: d, label: d === 'Special Needs' ? 'SPN (Special Needs)' : d }))}
              placeholder="Select division..."
              hasError={!!errors.division}
              disabled={divisionLocked}
            />
            {errors.division && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.division}</p>}
            {isMarketerRole && divisionLocked && (
              <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 4, fontStyle: 'italic' }}>Locked to your assigned division</p>
            )}

            {form.division === 'ALF' && (
              <div style={{ marginTop: 12 }}>
                <Label required>Facility</Label>
                <Select
                  value={form.facility_id}
                  onChange={(v) => setField('facility_id', v)}
                  options={availableFacilities.map((f) => ({ value: f.id, label: f.name }))}
                  placeholder="Select facility..."
                  hasError={!!errors.facility_id}
                />
                {errors.facility_id && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.facility_id}</p>}
              </div>
            )}

            {form.division === 'Special Needs' && (
              <div style={{ marginTop: 12 }}>
                <FieldGroup cols={2}>
                  <FieldBox label="Age Group" required>
                    <Select
                      value={form.sn_age_group}
                      onChange={(v) => setField('sn_age_group', v)}
                      options={[{ value: 'Adult', label: 'Adult' }, { value: 'Pediatric', label: 'Pediatric' }]}
                      placeholder="Select..."
                      hasError={!!errors.sn_age_group}
                    />
                    {errors.sn_age_group && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.sn_age_group}</p>}
                  </FieldBox>
                  <FieldBox label="County" required>
                    <Select
                      value={form.county}
                      onChange={(v) => setField('county', v)}
                      options={ALL_COUNTIES.map((c) => ({ value: c, label: c }))}
                      placeholder="Select county..."
                      hasError={!!errors.county}
                    />
                    {errors.county && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.county}</p>}
                  </FieldBox>
                </FieldGroup>

                {form.county && countyLicence && countyLicence !== 'both' && (
                  <p style={{ fontSize: 12, fontWeight: 600, color: palette.primaryMagenta.hex, marginTop: 8 }}>
                    Entity: <strong>{form.services_under_licence}</strong> (auto-assigned for {form.county})
                  </p>
                )}

                {form.county && countyLicence === 'both' && (
                  <div style={{ marginTop: 8 }}>
                    <Label required>Entity</Label>
                    <Select
                      value={form.services_under_licence}
                      onChange={(v) => setField('services_under_licence', v)}
                      options={[{ value: 'WB', label: 'Wellbound (WB)' }, { value: 'WBII', label: 'Wellbound II (WBII)' }]}
                      placeholder="Select entity..."
                      hasError={!!errors.services_under_licence}
                    />
                    {errors.services_under_licence && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.services_under_licence}</p>}
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <Label>Code 95 (OPWDD)</Label>
                  <Select
                    value={form.code_95}
                    onChange={(v) => setField('code_95', v)}
                    options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]}
                    placeholder="Select..."
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── 2. Attribution ── */}
          <div style={{ marginBottom: 24 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 12 }}>
              Attribution
            </p>
            <FieldGroup>
              <FieldBox label="Lead Source" required>
                <Select value={form.referral_source_id} onChange={(v) => setField('referral_source_id', v)} options={sourceOptions} placeholder="Select lead source…" hasError={!!errors.referral_source_id} />
                {errors.referral_source_id && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.referral_source_id}</p>}
                {form.referral_source_id === 'other' && (
                  <div style={{ marginTop: 8 }}>
                    <Input value={form.referral_source_other} onChange={(v) => setField('referral_source_other', v)} placeholder="Describe the lead source…" hasError={!!errors.referral_source_other} />
                    {errors.referral_source_other && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.referral_source_other}</p>}
                  </div>
                )}
              </FieldBox>
              <FieldBox label="Marketer" required>
                <Select value={form.marketer_id} onChange={(v) => setField('marketer_id', v)} options={marketerOptions} placeholder={facilityMarketerLinks ? 'Select facility marketer…' : 'Select marketer…'} hasError={!!errors.marketer_id} />
                {errors.marketer_id && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.marketer_id}</p>}
                {facilityMarketerLinks && form.marketer_id && form.marketer_id !== 'other' && (() => {
                  const link = facilityMarketerLinks.find((l) => l.marketer_id === form.marketer_id);
                  const isPrimary = link && (link.is_primary === true || link.is_primary === 'true');
                  if (isPrimary) return <p style={{ fontSize: 11, color: palette.accentGreen.hex, marginTop: 4, fontWeight: 600 }}>Primary marketer for this facility (auto-selected)</p>;
                  return null;
                })()}
                {form.marketer_id && form.marketer_id !== 'other' && !facilityMarketerLinks && appUserId && marketers.find((m) => m.id === form.marketer_id)?.user_id === appUserId && (
                  <p style={{ fontSize: 11, color: palette.accentGreen.hex, marginTop: 4, fontWeight: 600 }}>Auto-filled (you are the marketer for this referral)</p>
                )}
                {facilityMarketerLinks && (
                  <p style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 4, fontStyle: 'italic' }}>
                    Showing {facilityMarketerLinks.length} marketer{facilityMarketerLinks.length !== 1 ? 's' : ''} assigned to this facility
                  </p>
                )}
                {form.marketer_id === 'other' && (
                  <div style={{ marginTop: 8 }}>
                    <Input value={form.marketer_other} onChange={(v) => setField('marketer_other', v)} placeholder="Enter marketer name…" hasError={!!errors.marketer_other} />
                    {errors.marketer_other && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.marketer_other}</p>}
                  </div>
                )}
              </FieldBox>
            </FieldGroup>
          </div>

          {/* ── 3. Patient info ── */}
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 12 }}>
            Patient
          </p>
          <FieldGroup cols={2}>
            <FieldBox label="First Name" required>
              <Input value={form.first_name} onChange={(v) => setField('first_name', v)} placeholder="First name" hasError={!!errors.first_name} />
              {errors.first_name && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.first_name}</p>}
            </FieldBox>
            <FieldBox label="Last Name" required>
              <Input value={form.last_name} onChange={(v) => setField('last_name', v)} placeholder="Last name" hasError={!!errors.last_name} />
              {errors.last_name && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.last_name}</p>}
            </FieldBox>
            <FieldBox label="Primary Phone" required>
              <Input value={form.phone_primary} onChange={(v) => setField('phone_primary', v)} placeholder="(XXX) XXX-XXXX" type="tel" hasError={!!errors.phone_primary} />
              {errors.phone_primary && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.phone_primary}</p>}
            </FieldBox>
          </FieldGroup>

          {/* ── 4. Insurance + Physician side by side ── */}
          <div style={{ marginTop: 20, marginBottom: 4 }}>
            <FieldGroup cols={2}>
              <FieldBox label="Insurance Plans">
                <InsuranceMultiSelect
                  selected={form.insurance_plans}
                  onChange={setInsurancePlans}
                  planDetails={form.insurance_plan_details}
                  onPlanDetailChange={setInsurancePlanDetail}
                />
              </FieldBox>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 10 }}>
                  Referring / Ordering Physician
                </p>
                <PhysicianPicker physicianId={null} onChange={setSelectedPhysician} />
                {selectedPhysician && (
                  <p style={{ fontSize: 11, color: palette.accentGreen.hex, fontWeight: 600, marginTop: 6 }}>
                    Physician will be linked to this referral.
                  </p>
                )}
                {!selectedPhysician && (
                  <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.35), marginTop: 6 }}>
                    You may change this later.
                  </p>
                )}
              </div>
            </FieldGroup>
          </div>

          {/* ── 5. Optional patient details ── */}
          <SectionDivider title="Additional Patient Info" expanded={showPatientDetails} onToggle={() => setShowPatientDetails((v) => !v)} />
          {showPatientDetails && (
            <FieldGroup cols={2}>
              <FieldBox label="Date of Birth"><Input value={form.dob} onChange={(v) => setField('dob', v)} type="date" /></FieldBox>
              <FieldBox label="Gender"><Select value={form.gender} onChange={(v) => setField('gender', v)} options={GENDERS.map((g) => ({ value: g, label: g }))} placeholder="Select…" /></FieldBox>
              <FieldBox label="Secondary Phone"><Input value={form.phone_secondary} onChange={(v) => setField('phone_secondary', v)} placeholder="(XXX) XXX-XXXX" type="tel" /></FieldBox>
              <FieldBox label="Email">
                <Input value={form.email} onChange={(v) => setField('email', v)} placeholder="patient@email.com" type="email" hasError={!!errors.email} />
                {errors.email && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.email}</p>}
              </FieldBox>
              <FieldBox label="Medicaid #"><Input value={form.medicaid_number} onChange={(v) => setField('medicaid_number', v)} placeholder="Medicaid number" /></FieldBox>
              <FieldBox label="Medicare #"><Input value={form.medicare_number} onChange={(v) => setField('medicare_number', v)} placeholder="Medicare number" /></FieldBox>
              <FieldBox label="Insurance Member ID"><Input value={form.insurance_id} onChange={(v) => setField('insurance_id', v)} placeholder="Member ID" /></FieldBox>
              <FieldBox label="Address"><Input value={form.address_street} onChange={(v) => setField('address_street', v)} placeholder="Street address" /></FieldBox>
              <FieldBox label="City"><Input value={form.address_city} onChange={(v) => setField('address_city', v)} placeholder="City" /></FieldBox>
              <FieldBox label="Zip">
                <input
                  type="text"
                  value={form.address_zip || ''}
                  onChange={(e) => setField('address_zip', e.target.value)}
                  placeholder="Zip code"
                  maxLength={5}
                  pattern="[0-9]*"
                  style={{ ...inputBase, borderColor: errors.address_zip ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.12) }}
                  onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
                  onBlur={(e) => (e.target.style.borderColor = errors.address_zip ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.12))}
                />
                {errors.address_zip && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.address_zip}</p>}
              </FieldBox>
              <FieldBox label="Emergency Contact Name"><Input value={form.emergency_contact_name} onChange={(v) => setField('emergency_contact_name', v)} placeholder="Contact name" /></FieldBox>
              <FieldBox label="Emergency Contact Phone"><Input value={form.emergency_contact_phone} onChange={(v) => setField('emergency_contact_phone', v)} placeholder="(XXX) XXX-XXXX" type="tel" /></FieldBox>
            </FieldGroup>
          )}

          {/* ── 6. Optional referral details (services conditional on division) ── */}
          <SectionDivider title="Referral Details" expanded={showReferralDetails} onToggle={() => setShowReferralDetails((v) => !v)} />
          {showReferralDetails && (
            <FieldGroup cols={2}>
              <FieldBox label="Services Requested" fullWidth>
                {!form.division ? (
                  <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>Select a division first to see available services.</p>
                ) : (
                  <CheckboxGroup options={servicesForDivision} values={form.services_requested} onChange={(v) => setField('services_requested', v)} />
                )}
              </FieldBox>
              <FieldBox label="Initial Notes" fullWidth>
                <textarea
                  value={form.initial_notes}
                  onChange={(e) => setField('initial_notes', e.target.value)}
                  placeholder="Any initial context, notes, or observations…"
                  rows={3}
                  style={{ ...inputBase, resize: 'vertical' }}
                  onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
                  onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12))}
                />
              </FieldBox>
            </FieldGroup>
          )}

        </form>

        {/* Footer */}
        <div style={{ padding: '14px 24px 18px', borderTop: `1px solid var(--color-border)`, flexShrink: 0 }}>
          {error && (
            <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: hexToRgba(palette.primaryMagenta.hex, 0.08), fontSize: 12.5, color: palette.primaryMagenta.hex, lineHeight: 1.5 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.06), border: 'none', fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                style={{ padding: '9px 24px', borderRadius: 8, background: submitting ? hexToRgba(palette.primaryMagenta.hex, 0.4) : palette.primaryMagenta.hex, border: 'none', fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex, cursor: submitting ? 'not-allowed' : 'pointer', transition: 'background 0.15s', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                {submitting && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.75s linear infinite' }}>
                    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                    <circle cx="12" cy="12" r="10" stroke={hexToRgba(palette.backgroundLight.hex, 0.3)} strokeWidth="2.5" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke={palette.backgroundLight.hex} strokeWidth="2.5" strokeLinecap="round" />
                  </svg>
                )}
                {submitting ? 'Creating…' : 'Create Referral'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
