import { useState, useEffect, useMemo } from 'react';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import { useIsMobile } from '../../hooks/useIsMobile.js';
import { createPatient } from '../../api/patients.js';
import { createReferral, updateReferral } from '../../api/referrals.js';
import { createNote } from '../../api/notes.js';
import { useCareStore, mergeEntities } from '../../store/careStore.js';
import PhysicianPicker from '../physicians/PhysicianPicker.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const DIVISIONS = ['ALF', 'Special Needs'];
const GENDERS = ['Male', 'Female', 'Other', 'Prefer Not to Say'];
const SERVICES = ['SN', 'PT', 'OT', 'ST', 'HHA', 'ABA'];
const PRIORITIES = ['Low', 'Normal', 'High', 'Critical'];

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
  border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.12)}`,
  background: hexToRgba(palette.backgroundDark.hex, 0.03),
  fontSize: 13, color: palette.backgroundDark.hex,
  outline: 'none', fontFamily: 'inherit', transition: 'border-color 0.15s',
};

function Input({ value, onChange, placeholder, type = 'text', hasError }) {
  return (
    <input
      type={type}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...inputBase, borderColor: hasError ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.12) }}
      onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
      onBlur={(e) => (e.target.style.borderColor = hasError ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.12))}
    />
  );
}

function Select({ value, onChange, options, placeholder, hasError, disabled }) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{ ...inputBase, borderColor: hasError ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.12), cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
      onFocus={(e) => (e.target.style.borderColor = palette.primaryMagenta.hex)}
      onBlur={(e) => (e.target.style.borderColor = hasError ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.12))}
    >
      <option value="" disabled>{placeholder || 'Select…'}</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function FieldGroup({ children, cols = 2 }) {
  // cols prop is used on desktop; single column on mobile via CSS custom property
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
        width: '100%', padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 10, color: hexToRgba(palette.backgroundDark.hex, 0.55),
        fontSize: 12, fontWeight: 650, letterSpacing: '0.04em', textTransform: 'uppercase',
      }}
    >
      <span style={{ flex: 1, height: 1, background: hexToRgba(palette.backgroundDark.hex, 0.1) }} />
      {title}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
        <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span style={{ flex: 1, height: 1, background: hexToRgba(palette.backgroundDark.hex, 0.1) }} />
    </button>
  );
}

function CheckboxGroup({ label, options, values, onChange }) {
  function toggle(opt) {
    const arr = values || [];
    onChange(arr.includes(opt) ? arr.filter((v) => v !== opt) : [...arr, opt]);
  }
  return (
    <div>
      <Label>{label}</Label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
        {options.map((opt) => (
          <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={(values || []).includes(opt)} onChange={() => toggle(opt)} style={{ accentColor: palette.primaryMagenta.hex, width: 14, height: 14 }} />
            {opt}
          </label>
        ))}
      </div>
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

  // Resolve whether the signed-in user is a marketer
  const currentMarketer = useMemo(() => {
    if (!appUserId || !marketers.length) return null;
    return marketers.find((m) => m.user_id === appUserId) || null;
  }, [appUserId, marketers]);

  const isMarketerRole = useMemo(() => {
    if (!appUser?.role_id) return false;
    const role = Object.values(storeRoles).find((r) => r.id === appUser.role_id);
    return /market/i.test(role?.name || '');
  }, [appUser?.role_id, storeRoles]);

  // Division options: restricted for marketers based on their Marketers.division field
  const allowedDivisions = useMemo(() => {
    if (!isMarketerRole || !currentMarketer) return DIVISIONS;
    const md = currentMarketer.division;
    if (md === 'ALF') return ['ALF'];
    if (md === 'Special Needs') return ['Special Needs'];
    if (md === 'Both') return ['ALF', 'Special Needs'];
    return DIVISIONS;
  }, [isMarketerRole, currentMarketer]);

  const divisionLocked = allowedDivisions.length === 1;

  // Facilities scoped to the marketer's MarketerFacilities (or all if not a marketer)
  const availableFacilities = useMemo(() => {
    const allFacs = Object.values(storeFacilities);
    if (!isMarketerRole || !currentMarketer) {
      return allFacs.filter((f) => f.is_active !== false && f.is_active !== 'FALSE');
    }
    const mfJoins = Object.values(storeMarketerFacs).filter(
      (mf) => mf.marketer_id === currentMarketer.id,
    );
    const facilityIds = new Set(mfJoins.map((mf) => mf.facility_id));
    return allFacs.filter((f) => facilityIds.has(f.id) && f.is_active !== false && f.is_active !== 'FALSE');
  }, [storeFacilities, storeMarketerFacs, isMarketerRole, currentMarketer]);

  const [showPatientDetails, setShowPatientDetails] = useState(false);
  const [showReferralDetails, setShowReferralDetails] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [errors, setErrors] = useState({});
  const [selectedPhysician, setSelectedPhysician] = useState(null);

  // ── Form state ──────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    // Required
    first_name: '',
    last_name: '',
    phone_primary: '',
    insurance_plan: '',
    referral_source_id: '',
    referral_source_other: '',
    marketer_id: '',
    marketer_other: '',
    insurance_plan_other: '',
    // Patient details
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
    division: 'ALF',
    facility_id: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    // Referral details
    priority: 'Normal',
    services_requested: [],
    initial_notes: '',
  });

  function setField(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'division' && value !== 'ALF') next.facility_id = '';
      return next;
    });
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: null }));
  }

  // Auto-fill marketer if logged-in user is a marketer
  useEffect(() => {
    if (!appUserId || !marketers.length) return;
    const match = marketers.find((m) => m.user_id === appUserId);
    if (match) setField('marketer_id', match.id);
  }, [appUserId, marketers]);

  // Auto-select division when marketer has only one allowed option
  useEffect(() => {
    if (divisionLocked && form.division !== allowedDivisions[0]) {
      setField('division', allowedDivisions[0]);
    }
  }, [divisionLocked, allowedDivisions]);

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function validate() {
    const errs = {};
    if (!form.first_name.trim()) errs.first_name = 'Required';
    if (!form.last_name.trim()) errs.last_name = 'Required';
    if (!form.phone_primary.trim()) errs.phone_primary = 'Required';
    if (!form.insurance_plan) errs.insurance_plan = 'Required';
    if (form.insurance_plan === 'other' && !form.insurance_plan_other.trim()) errs.insurance_plan_other = 'Required';
    if (!form.referral_source_id) errs.referral_source_id = 'Required';
    if (form.referral_source_id === 'other' && !form.referral_source_other.trim()) errs.referral_source_other = 'Required';
    if (!form.marketer_id) errs.marketer_id = 'Required';
    if (form.marketer_id === 'other' && !form.marketer_other.trim()) errs.marketer_other = 'Required';
    if (form.division === 'ALF' && !form.facility_id) errs.facility_id = 'Required for ALF referrals';
    return errs;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSubmitting(true);
    setError(null);

    try {
      const patientCustomId = generateId('pat');
      const referralCustomId = generateId('ref');

      // ── Create patient ──────────────────────────────────────────────────
      const patientFields = {
        id: patientCustomId,
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        phone_primary: form.phone_primary.trim(),
        insurance_plan: form.insurance_plan === 'other' ? form.insurance_plan_other.trim() : form.insurance_plan,
        division: form.division,
        is_active: 'TRUE',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
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

      // ── Create referral ─────────────────────────────────────────────────
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
        current_stage: 'Lead Entry',
        division: form.division,
        priority: form.priority,
        referral_date: referralDate,
        created_at: referralDate,
        updated_at: referralDate,
        ...(form.services_requested.length && { services_requested: form.services_requested }),
        ...(form.facility_id && { facility_id: form.facility_id }),
        ...(appUserId && { intake_owner_id: appUserId }),
        ...(selectedPhysician?.id && { physician_id: selectedPhysician.id }),
      };

      const referralRecord = await createReferral(referralFields);

      // Push both records into the store immediately so the name resolves on first render
      mergeEntities('patients', { [patientRecord.id]: { _id: patientRecord.id, ...patientRecord.fields } });
      mergeEntities('referrals', { [referralRecord.id]: { _id: referralRecord.id, ...referralRecord.fields } });

      // Best-effort: save stage timer — silently ignored if field doesn't exist in Airtable yet
      if (referralRecord?._id) {
        updateReferral(referralRecord._id, { stage_entered_at: referralDate }).catch(() => {});
      }

      // Save initial notes as a Note record (non-blocking — don't fail the submission if this fails)
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

  // Insurance plan options
  const insurancePlanOptions = [
    ...INSURANCE_PLANS.map((p) => ({ value: p, label: p })),
    { value: 'other', label: 'Other / Not listed' },
  ];

  // Marketer options
  const marketerOptions = [
    ...marketers.map((m) => ({ value: m.id, label: `${m.first_name} ${m.last_name}` })),
    { value: 'other', label: 'Other / Not listed' },
  ];

  // Source options
  const sourceOptions = [
    ...sources.map((s) => ({ value: s.id, label: s.name })),
    { value: 'other', label: 'Other' },
  ];

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
        // Single-column fields on mobile via CSS custom property
        '--form-cols': isMobile ? '1' : undefined,
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid var(--color-border)`, flexShrink: 0, background: palette.primaryDeepPlum.hex }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundLight.hex, marginBottom: 3 }}>New Referral</h2>
              <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundLight.hex, 0.55) }}>
                Creates a patient record and initiates a Lead Entry referral
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

          {/* ── Attribution (lead source + marketer) ── */}
          <div style={{ padding: '14px 16px', borderRadius: 10, background: hexToRgba(palette.primaryDeepPlum.hex, 0.04), border: `1px solid ${hexToRgba(palette.primaryDeepPlum.hex, 0.1)}`, marginBottom: 20 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.primaryDeepPlum.hex, 0.6), marginBottom: 12 }}>
              Attribution — required
            </p>
            <FieldGroup>
              <FieldBox label="Lead Source" required>
                <Select
                  value={form.referral_source_id}
                  onChange={(v) => setField('referral_source_id', v)}
                  options={sourceOptions}
                  placeholder="Select lead source…"
                  hasError={!!errors.referral_source_id}
                />
                {errors.referral_source_id && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.referral_source_id}</p>}
                {form.referral_source_id === 'other' && (
                  <div style={{ marginTop: 8 }}>
                    <Input value={form.referral_source_other} onChange={(v) => setField('referral_source_other', v)} placeholder="Describe the lead source…" hasError={!!errors.referral_source_other} />
                    {errors.referral_source_other && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.referral_source_other}</p>}
                  </div>
                )}
              </FieldBox>

              <FieldBox label="Marketer" required>
                <Select
                  value={form.marketer_id}
                  onChange={(v) => setField('marketer_id', v)}
                  options={marketerOptions}
                  placeholder="Select marketer…"
                  hasError={!!errors.marketer_id}
                />
                {errors.marketer_id && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.marketer_id}</p>}
                {form.marketer_id && form.marketer_id !== 'other' && appUserId && marketers.find((m) => m.id === form.marketer_id)?.user_id === appUserId && (
                  <p style={{ fontSize: 11, color: palette.accentGreen.hex, marginTop: 4, fontWeight: 600 }}>Auto-filled — you are the marketer for this referral</p>
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

          {/* ── Required patient info ── */}
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 12 }}>
            Patient — required
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
            <FieldBox label="Insurance Plan" required>
              <Select
                value={form.insurance_plan}
                onChange={(v) => setField('insurance_plan', v)}
                options={insurancePlanOptions}
                placeholder="Select insurance plan…"
                hasError={!!errors.insurance_plan}
              />
              {errors.insurance_plan && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.insurance_plan}</p>}
              {form.insurance_plan === 'other' && (
                <div style={{ marginTop: 8 }}>
                  <Input value={form.insurance_plan_other} onChange={(v) => setField('insurance_plan_other', v)} placeholder="Enter insurance plan name…" hasError={!!errors.insurance_plan_other} />
                  {errors.insurance_plan_other && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.insurance_plan_other}</p>}
                </div>
              )}
            </FieldBox>
            <FieldBox label="Division" required>
              <Select
                value={form.division}
                onChange={(v) => setField('division', v)}
                options={allowedDivisions.map((d) => ({ value: d, label: d }))}
                placeholder="Select…"
                disabled={divisionLocked}
              />
              {isMarketerRole && divisionLocked && (
                <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 4, fontStyle: 'italic' }}>
                  Locked to your assigned division
                </p>
              )}
            </FieldBox>
            {form.division === 'ALF' && (
              <FieldBox label="Facility" required>
                <Select
                  value={form.facility_id}
                  onChange={(v) => setField('facility_id', v)}
                  options={availableFacilities.map((f) => ({ value: f.id, label: f.name }))}
                  placeholder="Select facility…"
                  hasError={!!errors.facility_id}
                />
                {errors.facility_id && <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>{errors.facility_id}</p>}
                {isMarketerRole && availableFacilities.length === 0 && (
                  <p style={{ fontSize: 11, color: palette.primaryMagenta.hex, marginTop: 4 }}>
                    No facilities assigned to you. Contact an administrator.
                  </p>
                )}
              </FieldBox>
            )}
          </FieldGroup>

          {/* ── PCP ── */}
          <div style={{ marginTop: 20, marginBottom: 4 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 10 }}>
              Referring / Ordering Physician
            </p>
            <PhysicianPicker
              physicianId={null}
              onChange={setSelectedPhysician}
            />
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

          {/* ── Optional patient details ── */}
          <SectionDivider
            title="Additional Patient Info"
            expanded={showPatientDetails}
            onToggle={() => setShowPatientDetails((v) => !v)}
          />
          {showPatientDetails && (
            <FieldGroup cols={2}>
              <FieldBox label="Date of Birth">
                <Input value={form.dob} onChange={(v) => setField('dob', v)} type="date" />
              </FieldBox>
              <FieldBox label="Gender">
                <Select value={form.gender} onChange={(v) => setField('gender', v)} options={GENDERS.map((g) => ({ value: g, label: g }))} placeholder="Select…" />
              </FieldBox>
              <FieldBox label="Secondary Phone">
                <Input value={form.phone_secondary} onChange={(v) => setField('phone_secondary', v)} placeholder="(XXX) XXX-XXXX" type="tel" />
              </FieldBox>
              <FieldBox label="Email">
                <Input value={form.email} onChange={(v) => setField('email', v)} placeholder="patient@email.com" type="email" />
              </FieldBox>
              <FieldBox label="Medicaid #">
                <Input value={form.medicaid_number} onChange={(v) => setField('medicaid_number', v)} placeholder="Medicaid number" />
              </FieldBox>
              <FieldBox label="Medicare #">
                <Input value={form.medicare_number} onChange={(v) => setField('medicare_number', v)} placeholder="Medicare number" />
              </FieldBox>
              <FieldBox label="Insurance Member ID">
                <Input value={form.insurance_id} onChange={(v) => setField('insurance_id', v)} placeholder="Member ID" />
              </FieldBox>
              <FieldBox label="Address">
                <Input value={form.address_street} onChange={(v) => setField('address_street', v)} placeholder="Street address" />
              </FieldBox>
              <FieldBox label="City">
                <Input value={form.address_city} onChange={(v) => setField('address_city', v)} placeholder="City" />
              </FieldBox>
              <FieldBox label="Zip">
                <Input value={form.address_zip} onChange={(v) => setField('address_zip', v)} placeholder="Zip code" />
              </FieldBox>
              <FieldBox label="Emergency Contact Name">
                <Input value={form.emergency_contact_name} onChange={(v) => setField('emergency_contact_name', v)} placeholder="Contact name" />
              </FieldBox>
              <FieldBox label="Emergency Contact Phone">
                <Input value={form.emergency_contact_phone} onChange={(v) => setField('emergency_contact_phone', v)} placeholder="(XXX) XXX-XXXX" type="tel" />
              </FieldBox>
            </FieldGroup>
          )}

          {/* ── Optional referral details ── */}
          <SectionDivider
            title="Referral Details"
            expanded={showReferralDetails}
            onToggle={() => setShowReferralDetails((v) => !v)}
          />
          {showReferralDetails && (
            <FieldGroup cols={2}>
              <FieldBox label="Priority">
                <Select value={form.priority} onChange={(v) => setField('priority', v)} options={PRIORITIES.map((p) => ({ value: p, label: p }))} placeholder="Normal" />
              </FieldBox>
              <div />
              <FieldBox label="Services Requested" fullWidth>
                <CheckboxGroup options={SERVICES} values={form.services_requested} onChange={(v) => setField('services_requested', v)} />
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

        {/* Footer — sticky, always visible even on mobile with keyboard up */}
        <div style={{ padding: '14px 24px 18px', borderTop: `1px solid var(--color-border)`, flexShrink: 0 }}>

          {/* Error banner — lives in the footer so it's never scrolled out of view */}
          {error && (
            <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: hexToRgba(palette.primaryMagenta.hex, 0.08), border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.25)}`, fontSize: 12.5, color: palette.primaryMagenta.hex, lineHeight: 1.5 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            Creates patient + starts a Lead Entry referral
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={onClose} style={{ padding: '9px 18px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.06), border: `1px solid var(--color-border)`, fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>
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
          </div> {/* end flex row */}
        </div>
      </div>
    </div>
  );
}
