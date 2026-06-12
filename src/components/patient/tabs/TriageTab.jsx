/**
 * TriageTab (v2) — Special Needs Triage form, implements
 * careStream/triage_forms_spec.md.
 *
 * High-level behavior:
 *
 *   - Adult vs Pediatric form is chosen automatically from
 *     `referral.sn_age_group` ('Adult' | 'Pediatric'), with a fallback to
 *     deriving the age group from `patient.dob` for legacy referrals that
 *     never had the field set.
 *
 *   - Demographics that already live on the patient record (name, dob,
 *     address, email, medicaid number, insurance plan, emergency contact)
 *     auto-populate the triage form ONCE — the next time the user opens
 *     this tab on a fresh triage record. The user can edit them; their
 *     edits are saved on the triage row and never push back to the
 *     patient record (the user changes Demographics for that).
 *
 *   - Every change auto-saves with a small debounce (~700ms after the last
 *     keystroke, or immediately on blur). There's no "Edit / Save" toggle:
 *     the source of truth is whatever's in the inputs at any moment.
 *
 *   - The triage is "complete" (drives the green dot in PatientSnapshot and
 *     the checkmark on the F2F tab, etc.) only when ALL required fields are
 *     filled and valid, per `isTriageComplete()`. Conditional children are
 *     only required when their parent gate is in the Yes/No state that the
 *     spec marks as "shown if…".
 *
 *   - Selecting opwdd_status = 'OPWDD Pending' is the new equivalent of the
 *     old code_95='No' — we surface a confirmation modal before routing the
 *     patient to OPWDD Enrollment and writing the OPWDD eligibility case.
 *
 * Database fields:
 *   The v2 schema adds new columns in TriageAdult / TriagePediatric (see
 *   scripts/airtable-apply-schema.js, ~line 290). The old columns
 *   (caregiver_name, pet_details, is_diabetic, homecare_hours, ...) stay
 *   in place so historical records remain readable, but the new form no
 *   longer writes to them.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import {
  getTriageAdult, createTriageAdult, updateTriageAdult,
  getTriagePediatric, createTriagePediatric, updateTriagePediatric,
} from '../../../api/triage.js';
import { updateReferral } from '../../../api/referrals.js';
import { attemptTransition, applyTransition } from '../../../engine/transitionEngine.js';
import { openCaseForReferral } from '../../../store/opwddOrchestration.js';
import { triggerDataRefresh } from '../../../hooks/useRefreshTrigger.js';
import { mergeEntities } from '../../../store/careStore.js';
import { useLookups } from '../../../hooks/useLookups.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import PhysicianPicker from '../../physicians/PhysicianPicker.jsx';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';
import { usePermissions } from '../../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../../data/permissionKeys.js';
import { isTriageComplete } from '../../../utils/triageCompleteness.js';
import { inferAgeGroupFromDob, getDobBoundsForAgeGroup } from '../../../utils/validation.js';
import {
  SmartPhoneInput,
  SmartEmailInput,
  SmartNpiInput,
  SmartAddressInput,
  SmartDateInput,
  TriStateRadio,
  SegmentedPicker,
} from '../../common/SmartFields.jsx';

// ── Constants ────────────────────────────────────────────────────────────────

const OPWDD_OPTIONS = ['OPWDD Eligible', 'OPWDD Pending', 'Non-OPWDD'];
const CCO_OPTIONS = ['Advance Care Alliance (ACA/NY)', 'Care Design NY', 'Tri-County Care'];

const ADULT_SERVICES   = ['PT', 'OT', 'ST', 'HHA'];
const PEDIATRIC_SERVICES = ['PT', 'OT', 'ST', 'ABA'];

// Per-form blank skeleton. Used so the completeness checker sees explicit
// null/empty values for every required field on a fresh record — without
// this, missing keys would short-circuit the check (see the back-compat
// guard in triageCompleteness.js).
const ADULT_BLANK = {
  opwdd_status: null,
  insurance_plan_name: '',
  medicaid_number: '',
  patient_name: '',
  dob: '',
  address: '',
  email: '',
  caregiver_name: '',
  caregiver_phone: '',
  add_secondary_caregiver: null,
  secondary_caregiver_name: '',
  secondary_caregiver_phone: '',
  has_pets: null,
  has_smoking: null,
  has_homecare_services: null,
  homecare_agency_name: '',
  homecare_hours_days: '',
  has_community_hab: null,
  has_in_home_therapies: null,
  current_therapy_services: '',
  services_needed: [],
  therapy_availability: '',
  hha_hours_frequency: '',
  health_conditions: '',
  pcp_name: '',
  pcp_last_visit: '',
  pcp_phone: '',
  pcp_fax: '',
  pcp_address: '',
  pcp_npi_number: '',
  cco_name: '',
  cm_name: '',
  cm_phone: '',
  cm_fax: '',
  cm_email: '',
};

const PED_BLANK = {
  opwdd_status: null,
  medicaid_number: '',
  phone_call_made_to: '',
  primary_caregiver_name: '',
  primary_caregiver_phone: '',
  add_secondary_caregiver: null,
  secondary_caregiver_name: '',
  secondary_caregiver_phone: '',
  emergency_same_as_primary: null,
  emergency_contact_name: '',
  emergency_contact_phone: '',
  email: '',
  patient_name: '',
  dob: '',
  address: '',
  has_pets: null,
  has_smoking: null,
  has_homecare_services: null,
  homecare_agency_name: '',
  homecare_hours_days: '',
  boe_services: '',
  has_community_hab: null,
  services_needed: [],
  therapy_availability: '',
  health_conditions: '',
  school_bus_time: '',
  has_recent_hospitalization: null,
  pcp_name: '',
  pcp_last_visit: '',
  pcp_phone: '',
  pcp_fax: '',
  pcp_address: '',
  cco_name: '',
  cm_name: '',
  cm_phone: '',
  cm_fax: '',
  cm_email: '',
};

// ── DB normalization ────────────────────────────────────────────────────────
//
// Airtable's `dateTime` columns return ISO strings; our forms work in
// YYYY-MM-DD. Yes/No three-state booleans are stored as the strings
// 'Yes'/'No' so the spec's explicit-Yes / explicit-No / null distinction
// survives the round trip. Phones go in as digits-only; the smart inputs
// already strip everything else.

const TRI_STATE_FIELDS = new Set([
  'add_secondary_caregiver',
  'emergency_same_as_primary',
  'has_pets',
  'has_smoking',
  'has_homecare_services',
  'has_community_hab',
  'has_in_home_therapies',
  'has_recent_hospitalization',
]);

const DATE_FIELDS = new Set(['dob', 'pcp_last_visit']);

function normalizeIncoming(fields, blank) {
  const out = { ...blank };
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === null || v === undefined) continue;
    if (TRI_STATE_FIELDS.has(k)) {
      out[k] = boolToTri(v);
    } else if (DATE_FIELDS.has(k)) {
      out[k] = typeof v === 'string' ? v.split('T')[0] : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function boolToTri(val) {
  if (val === true || val === 'true' || val === 'TRUE' || val === 'Yes') return 'Yes';
  if (val === false || val === 'false' || val === 'FALSE' || val === 'No') return 'No';
  return null;
}

function buildPayloadForSave(data, allowedKeys) {
  const fields = {};
  for (const k of allowedKeys) {
    const v = data[k];
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim() === '' && DATE_FIELDS.has(k)) continue;
    if (typeof v === 'string' && v === '' && !TRI_STATE_FIELDS.has(k)) {
      // Send an explicit empty string for non-date text so a previously-set
      // value can be cleared. Airtable treats '' as "clear this field".
      fields[k] = '';
      continue;
    }
    if (Array.isArray(v) && v.length === 0) {
      // Same idea — empty arrays clear the multi-select.
      fields[k] = [];
      continue;
    }
    if (TRI_STATE_FIELDS.has(k)) {
      if (v === 'Yes' || v === true) fields[k] = 'Yes';
      else if (v === 'No' || v === false) fields[k] = 'No';
      // null => skip (preserves "unanswered" state)
      continue;
    }
    if (DATE_FIELDS.has(k) && typeof v === 'string' && v.length === 10) {
      // Pass the date-only ISO string through unchanged; Airtable accepts it
      // for `dateTime` columns and treats it as midnight in the configured TZ.
      fields[k] = v;
      continue;
    }
    fields[k] = v;
  }
  return fields;
}

// Which DB columns each form is allowed to write — also serves as the
// "stop sending fields you no longer use" whitelist (Airtable rejects the
// whole record if you send a field name the table doesn't have).
const ADULT_COLUMNS = new Set([
  'referral_id', 'filled_by_id',
  // OPWDD
  'opwdd_status',
  // Eligibility
  'insurance_plan_name', 'medicaid_number',
  // Patient Info
  'patient_name', 'dob', 'address', 'email',
  // Caregiver Info
  'caregiver_name', 'caregiver_phone',
  'add_secondary_caregiver', 'secondary_caregiver_name', 'secondary_caregiver_phone',
  // Home Env
  'has_pets', 'has_smoking',
  // Current Services
  'has_homecare_services', 'homecare_agency_name', 'homecare_hours_days',
  'has_community_hab',
  'has_in_home_therapies', 'current_therapy_services',
  // Requested Services
  'services_needed', 'therapy_availability', 'hha_hours_frequency',
  // Clinical
  'health_conditions',
  // PCP
  'pcp_name', 'pcp_last_visit', 'pcp_phone', 'pcp_fax', 'pcp_address', 'pcp_npi_number',
  // Care Mgmt
  'cco_name', 'cm_name', 'cm_phone', 'cm_fax', 'cm_email',
  // Timestamps
  'created_at', 'updated_at',
]);

const PEDIATRIC_COLUMNS = new Set([
  'referral_id', 'filled_by_id',
  // OPWDD
  'opwdd_status',
  // Eligibility
  'medicaid_number',
  // Contact Info
  'phone_call_made_to', 'primary_caregiver_name', 'primary_caregiver_phone',
  'add_secondary_caregiver', 'secondary_caregiver_name', 'secondary_caregiver_phone',
  'emergency_same_as_primary', 'emergency_contact_name', 'emergency_contact_phone',
  'email',
  // Patient Info
  'patient_name', 'dob', 'address',
  // Home Env
  'has_pets', 'has_smoking',
  // Current Services
  'has_homecare_services', 'homecare_agency_name', 'homecare_hours_days',
  'boe_services', 'has_community_hab',
  // Requested Services
  'services_needed', 'therapy_availability',
  // Clinical
  'health_conditions', 'school_bus_time', 'has_recent_hospitalization',
  // PCP (no NPI for pediatric per spec)
  'pcp_name', 'pcp_last_visit', 'pcp_phone', 'pcp_fax', 'pcp_address',
  // Care Mgmt
  'cco_name', 'cm_name', 'cm_phone', 'cm_fax', 'cm_email',
  // Timestamps
  'created_at', 'updated_at',
]);

// ── Display helpers ─────────────────────────────────────────────────────────

function formatDateTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' + new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function getInitials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function FilledByRow({ name, date, clerkImageUrl, onPrint, savingStatus }) {
  const initials = getInitials(name);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, paddingBottom: 16, borderBottom: `1px solid var(--color-border)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {clerkImageUrl ? (
          <img src={clerkImageUrl} alt={name} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, background: hexToRgba(palette.primaryMagenta.hex, 0.14), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 800, color: palette.primaryMagenta.hex }}>
            {initials}
          </div>
        )}
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: palette.backgroundDark.hex, lineHeight: 1.2 }}>{name}</p>
          {date && (
            <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 1 }}>
              {formatDateTime(date)}
            </p>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {savingStatus && (
          <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), fontStyle: 'italic' }}>{savingStatus}</p>
        )}
        <button onClick={onPrint} title="Print / Export PDF"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 8, background: 'none', border: 'none', color: hexToRgba(palette.backgroundDark.hex, 0.4), cursor: 'pointer' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.06); e.currentTarget.style.color = palette.backgroundDark.hex; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = hexToRgba(palette.backgroundDark.hex, 0.4); }}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
            <path d="M6 9V2h12v7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            <rect x="6" y="14" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.7"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

function FormSection({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.38), marginBottom: 12, paddingBottom: 6, borderBottom: `1px solid var(--color-border)` }}>
        {title}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, required, error, hint, children }) {
  return (
    <div style={error ? { borderLeft: `2px solid ${palette.primaryMagenta.hex}`, paddingLeft: 8 } : undefined}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: error ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.6), marginBottom: 5 }}>
        {label} {required && <span style={{ color: palette.primaryMagenta.hex }}>*</span>}
      </label>
      {children}
      {hint && (
        <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 4, fontStyle: 'italic' }}>{hint}</p>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 7,
  border: `1px solid var(--color-border)`,
  background: hexToRgba(palette.backgroundDark.hex, 0.03),
  fontSize: 13, color: palette.backgroundDark.hex,
  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
};

function TextInput({ value, onChange, placeholder, type = 'text', disabled }) {
  return (
    <input type={type} value={value || ''} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} disabled={disabled}
      style={{ ...inputStyle, opacity: disabled ? 0.6 : 1 }}
      onFocus={(e) => !disabled && (e.target.style.borderColor = palette.primaryMagenta.hex)}
      onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12))}
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 3, disabled }) {
  return (
    <textarea value={value || ''} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} rows={rows} disabled={disabled}
      style={{ ...inputStyle, resize: 'vertical', opacity: disabled ? 0.6 : 1 }}
      onFocus={(e) => !disabled && (e.target.style.borderColor = palette.primaryMagenta.hex)}
      onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.12))}
    />
  );
}

function CheckboxGroup({ options, values = [], onChange, disabled }) {
  function toggle(opt) {
    if (disabled) return;
    const arr = Array.isArray(values) ? values : [];
    const next = arr.includes(opt) ? arr.filter((v) => v !== opt) : [...arr, opt];
    onChange(next);
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((opt) => {
        const active = (values || []).includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => toggle(opt)}
            disabled={disabled}
            style={{
              padding: '6px 14px',
              borderRadius: 7,
              border: `1px solid ${active ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.14)}`,
              background: active ? hexToRgba(palette.primaryMagenta.hex, 0.1) : hexToRgba(palette.backgroundDark.hex, 0.03),
              color: active ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.65),
              fontSize: 12.5,
              fontWeight: active ? 700 : 600,
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'all 0.12s',
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

// ── Conditional helpers ─────────────────────────────────────────────────────

function isYesLike(v) { return v === 'Yes' || v === true; }
function isNoLike(v)  { return v === 'No'  || v === false; }
function hasTherapy(services) {
  return Array.isArray(services) && services.some((s) => /^(PT|OT|ST)$/.test(String(s)));
}

// When a parent gate flips to a state that hides its children, blank out the
// children so they don't sit in the DB as orphan answers. Returns a partial
// patch object the parent can merge.
function clearChildren(parentField, newParentValue, formType) {
  // Map: parent → [children to wipe when not-triggered]
  const ADULT_MAP = {
    add_secondary_caregiver: ['secondary_caregiver_name', 'secondary_caregiver_phone'],
    has_homecare_services:   ['homecare_agency_name', 'homecare_hours_days'],
    has_in_home_therapies:   ['current_therapy_services'],
  };
  const PED_MAP = {
    add_secondary_caregiver:   ['secondary_caregiver_name', 'secondary_caregiver_phone'],
    emergency_same_as_primary: ['emergency_contact_name', 'emergency_contact_phone'],
    has_homecare_services:     ['homecare_agency_name', 'homecare_hours_days'],
  };
  const map = formType === 'pediatric' ? PED_MAP : ADULT_MAP;
  const children = map[parentField];
  if (!children) return {};

  // Emergency same as primary uses inverse trigger: NO shows the children.
  const trigger = parentField === 'emergency_same_as_primary' ? 'No' : 'Yes';
  const shown = trigger === 'Yes' ? isYesLike(newParentValue) : isNoLike(newParentValue);
  if (shown) return {};
  const patch = {};
  for (const c of children) patch[c] = '';
  return patch;
}

// ── Adult form ──────────────────────────────────────────────────────────────

function AdultForm({ data, set, missing, dobBounds, dobHint, disabled, forceValidate }) {
  function pickGate(field) {
    return (v) => set({ ...data, [field]: v, ...clearChildren(field, v, 'adult') });
  }
  function setServices(arr) {
    const next = { ...data, services_needed: arr };
    if (!hasTherapy(arr)) next.therapy_availability = '';
    if (!arr.includes('HHA')) next.hha_hours_frequency = '';
    set(next);
  }
  function setPcp(phy) {
    if (!phy) { set({ ...data, pcp_name: '', pcp_phone: '', pcp_fax: '', pcp_address: '', pcp_npi_number: data.pcp_npi_number }); return; }
    const addr = [phy.address_street, phy.address_city, phy.address_state, phy.address_zip].filter(Boolean).join(', ');
    set({
      ...data,
      pcp_name: `Dr. ${phy.first_name || ''} ${phy.last_name || ''}`.trim(),
      pcp_phone: phy.phone || data.pcp_phone || '',
      pcp_fax:   phy.fax   || data.pcp_fax   || '',
      pcp_address: addr || data.pcp_address || '',
      pcp_npi_number: phy.npi || data.pcp_npi_number || '',
    });
  }

  return (
    <>
      <FormSection title="OPWDD">
        <Field label="OPWDD Status" required error={missing.has('opwdd_status')}>
          <SegmentedPicker value={data.opwdd_status || ''} options={OPWDD_OPTIONS} onChange={(v) => set({ ...data, opwdd_status: v })} disabled={disabled} />
        </Field>
      </FormSection>

      <FormSection title="Eligibility">
        <Field label="Insurance Plan Name" required error={missing.has('insurance_plan_name')}>
          <TextInput value={data.insurance_plan_name} onChange={(v) => set({ ...data, insurance_plan_name: v })} disabled={disabled} />
        </Field>
        <Field label="Medicaid Number" required error={missing.has('medicaid_number')}>
          <TextInput value={data.medicaid_number} onChange={(v) => set({ ...data, medicaid_number: v })} disabled={disabled} />
        </Field>
      </FormSection>

      <FormSection title="Patient Information">
        <Field label="Patient First and Last Name" required error={missing.has('patient_name')}>
          <TextInput value={data.patient_name} onChange={(v) => set({ ...data, patient_name: v })} disabled={disabled} />
        </Field>
        <Field label="Date of Birth" required error={missing.has('dob')} hint={dobHint}>
          <SmartDateInput value={data.dob} onChange={(v) => set({ ...data, dob: v })} min={dobBounds.min} max={dobBounds.max} disabled={disabled} />
        </Field>
        <Field label="Address" required error={missing.has('address')}>
          <SmartAddressInput value={data.address} onChange={(v) => set({ ...data, address: v })} disabled={disabled} />
        </Field>
        <Field label="Email Address" required error={missing.has('email')}>
          <SmartEmailInput value={data.email} onChange={(v) => set({ ...data, email: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
      </FormSection>

      <FormSection title="Caregiver Information">
        <Field label="Primary Caregiver Name" required error={missing.has('caregiver_name')}>
          <TextInput value={data.caregiver_name} onChange={(v) => set({ ...data, caregiver_name: v })} disabled={disabled} />
        </Field>
        <Field label="Primary Caregiver Phone Number" required error={missing.has('caregiver_phone')}>
          <SmartPhoneInput value={data.caregiver_phone} onChange={(v) => set({ ...data, caregiver_phone: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
        <Field label="Add Secondary Parent / Caregiver?" required error={missing.has('add_secondary_caregiver')}>
          <TriStateRadio name="add_secondary_caregiver" value={data.add_secondary_caregiver} onChange={pickGate('add_secondary_caregiver')} disabled={disabled} />
        </Field>
        {isYesLike(data.add_secondary_caregiver) && (
          <>
            <Field label="Secondary Caregiver Name" required error={missing.has('secondary_caregiver_name')}>
              <TextInput value={data.secondary_caregiver_name} onChange={(v) => set({ ...data, secondary_caregiver_name: v })} disabled={disabled} />
            </Field>
            <Field label="Secondary Caregiver Phone Number" required error={missing.has('secondary_caregiver_phone')}>
              <SmartPhoneInput value={data.secondary_caregiver_phone} onChange={(v) => set({ ...data, secondary_caregiver_phone: v })} disabled={disabled} forceValidate={forceValidate} />
            </Field>
          </>
        )}
      </FormSection>

      <FormSection title="Home Environment">
        <Field label="Are there any pets in the home?" required error={missing.has('has_pets')}>
          <TriStateRadio name="has_pets" value={data.has_pets} onChange={(v) => set({ ...data, has_pets: v })} disabled={disabled} />
        </Field>
        <Field label="Is there smoking in the home?" required error={missing.has('has_smoking')}>
          <TriStateRadio name="has_smoking" value={data.has_smoking} onChange={(v) => set({ ...data, has_smoking: v })} disabled={disabled} />
        </Field>
      </FormSection>

      <FormSection title="Current Services">
        <Field label="Does the patient currently receive homecare services (LHCSA / CHHA)?" required error={missing.has('has_homecare_services')}>
          <TriStateRadio name="has_homecare_services" value={data.has_homecare_services} onChange={pickGate('has_homecare_services')} disabled={disabled} />
        </Field>
        {isYesLike(data.has_homecare_services) && (
          <>
            <Field label="Current Agency Name" required error={missing.has('homecare_agency_name')}>
              <TextInput value={data.homecare_agency_name} onChange={(v) => set({ ...data, homecare_agency_name: v })} disabled={disabled} />
            </Field>
            <Field label="Current Hours and Days of Service" required error={missing.has('homecare_hours_days')}>
              <TextArea rows={2} value={data.homecare_hours_days} onChange={(v) => set({ ...data, homecare_hours_days: v })} disabled={disabled} />
            </Field>
          </>
        )}
        <Field label="Does the patient currently receive community habilitation, respite, or reshab services?" required error={missing.has('has_community_hab')}>
          <TriStateRadio name="has_community_hab" value={data.has_community_hab} onChange={(v) => set({ ...data, has_community_hab: v })} disabled={disabled} />
        </Field>
        <Field label="Does the patient currently receive in-home therapies?" required error={missing.has('has_in_home_therapies')}>
          <TriStateRadio name="has_in_home_therapies" value={data.has_in_home_therapies} onChange={pickGate('has_in_home_therapies')} disabled={disabled} />
        </Field>
        {isYesLike(data.has_in_home_therapies) && (
          <Field label="Current Therapy Services" required error={missing.has('current_therapy_services')}>
            <TextArea rows={2} value={data.current_therapy_services} onChange={(v) => set({ ...data, current_therapy_services: v })} disabled={disabled} />
          </Field>
        )}
      </FormSection>

      <FormSection title="Requested Services">
        <Field label="What services are being requested for the patient?" required error={missing.has('services_needed')}>
          <CheckboxGroup options={ADULT_SERVICES} values={data.services_needed} onChange={setServices} disabled={disabled} />
        </Field>
        {hasTherapy(data.services_needed) && (
          <Field label="Therapy Availability" required error={missing.has('therapy_availability')}>
            <TextArea rows={2} value={data.therapy_availability} onChange={(v) => set({ ...data, therapy_availability: v })} disabled={disabled} />
          </Field>
        )}
        {(data.services_needed || []).includes('HHA') && (
          <Field label="Requested HHA Hours and Frequency" required error={missing.has('hha_hours_frequency')}>
            <TextArea rows={2} value={data.hha_hours_frequency} onChange={(v) => set({ ...data, hha_hours_frequency: v })} disabled={disabled} />
          </Field>
        )}
      </FormSection>

      <FormSection title="Clinical Information">
        <Field label="Any health conditions or diagnoses?" required error={missing.has('health_conditions')}>
          <TextArea rows={3} value={data.health_conditions} onChange={(v) => set({ ...data, health_conditions: v })} disabled={disabled} />
        </Field>
      </FormSection>

      <FormSection title="Primary Care Physician Information">
        <Field label="Primary Care Physician" required error={missing.has('pcp_name')}>
          <PhysicianPicker
            physicianId={null}
            physicianName={data.pcp_name}
            onChange={setPcp}
            readOnly={disabled}
            compact
          />
        </Field>
        <Field label="Date of Last PCP Visit" required error={missing.has('pcp_last_visit')}>
          <SmartDateInput value={data.pcp_last_visit} onChange={(v) => set({ ...data, pcp_last_visit: v })} max={new Date().toISOString().split('T')[0]} disabled={disabled} />
        </Field>
        <Field label="PCP Phone Number" required error={missing.has('pcp_phone')}>
          <SmartPhoneInput value={data.pcp_phone} onChange={(v) => set({ ...data, pcp_phone: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
        <Field label="PCP Fax Number" required error={missing.has('pcp_fax')}>
          <SmartPhoneInput value={data.pcp_fax} onChange={(v) => set({ ...data, pcp_fax: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
        <Field label="PCP Address" required error={missing.has('pcp_address')}>
          <SmartAddressInput value={data.pcp_address} onChange={(v) => set({ ...data, pcp_address: v })} disabled={disabled} />
        </Field>
        <Field label="PCP NPI Number" required error={missing.has('pcp_npi_number')}>
          <SmartNpiInput value={data.pcp_npi_number} onChange={(v) => set({ ...data, pcp_npi_number: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
      </FormSection>

      <FormSection title="Care Management">
        <Field label="CCO Name" required error={missing.has('cco_name')}>
          <SegmentedPicker value={data.cco_name || ''} options={CCO_OPTIONS} onChange={(v) => set({ ...data, cco_name: v })} disabled={disabled} />
        </Field>
        <Field label="Care Manager Name" required error={missing.has('cm_name')}>
          <TextInput value={data.cm_name} onChange={(v) => set({ ...data, cm_name: v })} disabled={disabled} />
        </Field>
        <Field label="Care Manager Phone Number" required error={missing.has('cm_phone')}>
          <SmartPhoneInput value={data.cm_phone} onChange={(v) => set({ ...data, cm_phone: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
        <Field label="Care Manager Fax Number" required error={missing.has('cm_fax')}>
          <SmartPhoneInput value={data.cm_fax} onChange={(v) => set({ ...data, cm_fax: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
        <Field label="Care Manager Email Address" required error={missing.has('cm_email')}>
          <SmartEmailInput value={data.cm_email} onChange={(v) => set({ ...data, cm_email: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
      </FormSection>
    </>
  );
}

// ── Pediatric form ──────────────────────────────────────────────────────────

function PediatricForm({ data, set, missing, dobBounds, dobHint, disabled, forceValidate }) {
  function pickGate(field) {
    return (v) => set({ ...data, [field]: v, ...clearChildren(field, v, 'pediatric') });
  }
  function setServices(arr) {
    const next = { ...data, services_needed: arr };
    if (!hasTherapy(arr)) next.therapy_availability = '';
    set(next);
  }
  function setPcp(phy) {
    if (!phy) { set({ ...data, pcp_name: '', pcp_phone: '', pcp_fax: '', pcp_address: '' }); return; }
    const addr = [phy.address_street, phy.address_city, phy.address_state, phy.address_zip].filter(Boolean).join(', ');
    set({
      ...data,
      pcp_name: `Dr. ${phy.first_name || ''} ${phy.last_name || ''}`.trim(),
      pcp_phone: phy.phone || data.pcp_phone || '',
      pcp_fax:   phy.fax   || data.pcp_fax   || '',
      pcp_address: addr || data.pcp_address || '',
    });
  }

  return (
    <>
      <FormSection title="OPWDD">
        <Field label="OPWDD Status" required error={missing.has('opwdd_status')}>
          <SegmentedPicker value={data.opwdd_status || ''} options={OPWDD_OPTIONS} onChange={(v) => set({ ...data, opwdd_status: v })} disabled={disabled} />
        </Field>
      </FormSection>

      <FormSection title="Eligibility">
        <Field label="Medicaid Number" required error={missing.has('medicaid_number')}>
          <TextInput value={data.medicaid_number} onChange={(v) => set({ ...data, medicaid_number: v })} disabled={disabled} />
        </Field>
      </FormSection>

      <FormSection title="Contact Information">
        <Field label="Phone Call Made To" required error={missing.has('phone_call_made_to')}>
          <TextInput value={data.phone_call_made_to} onChange={(v) => set({ ...data, phone_call_made_to: v })} disabled={disabled} />
        </Field>
        <Field label="Primary Caregiver Name" required error={missing.has('primary_caregiver_name')}>
          <TextInput value={data.primary_caregiver_name} onChange={(v) => set({ ...data, primary_caregiver_name: v })} disabled={disabled} />
        </Field>
        <Field label="Primary Caregiver Phone Number" required error={missing.has('primary_caregiver_phone')}>
          <SmartPhoneInput value={data.primary_caregiver_phone} onChange={(v) => set({ ...data, primary_caregiver_phone: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
        <Field label="Add Secondary Caregiver?" required error={missing.has('add_secondary_caregiver')}>
          <TriStateRadio name="add_secondary_caregiver" value={data.add_secondary_caregiver} onChange={pickGate('add_secondary_caregiver')} disabled={disabled} />
        </Field>
        {isYesLike(data.add_secondary_caregiver) && (
          <>
            <Field label="Secondary Caregiver Name" required error={missing.has('secondary_caregiver_name')}>
              <TextInput value={data.secondary_caregiver_name} onChange={(v) => set({ ...data, secondary_caregiver_name: v })} disabled={disabled} />
            </Field>
            <Field label="Secondary Caregiver Phone Number" required error={missing.has('secondary_caregiver_phone')}>
              <SmartPhoneInput value={data.secondary_caregiver_phone} onChange={(v) => set({ ...data, secondary_caregiver_phone: v })} disabled={disabled} forceValidate={forceValidate} />
            </Field>
          </>
        )}
        <Field label="Emergency contact same as Primary Caregiver Contact?" required error={missing.has('emergency_same_as_primary')}>
          <TriStateRadio name="emergency_same_as_primary" value={data.emergency_same_as_primary} onChange={pickGate('emergency_same_as_primary')} disabled={disabled} />
        </Field>
        {isNoLike(data.emergency_same_as_primary) && (
          <>
            <Field label="Emergency Contact Name" required error={missing.has('emergency_contact_name')}>
              <TextInput value={data.emergency_contact_name} onChange={(v) => set({ ...data, emergency_contact_name: v })} disabled={disabled} />
            </Field>
            <Field label="Emergency Contact Phone Number" required error={missing.has('emergency_contact_phone')}>
              <SmartPhoneInput value={data.emergency_contact_phone} onChange={(v) => set({ ...data, emergency_contact_phone: v })} disabled={disabled} forceValidate={forceValidate} />
            </Field>
          </>
        )}
        <Field label="Email Address" required error={missing.has('email')}>
          <SmartEmailInput value={data.email} onChange={(v) => set({ ...data, email: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
      </FormSection>

      <FormSection title="Patient Information">
        <Field label="Patient First and Last Name" required error={missing.has('patient_name')}>
          <TextInput value={data.patient_name} onChange={(v) => set({ ...data, patient_name: v })} disabled={disabled} />
        </Field>
        <Field label="Date of Birth" required error={missing.has('dob')} hint={dobHint}>
          <SmartDateInput value={data.dob} onChange={(v) => set({ ...data, dob: v })} min={dobBounds.min} max={dobBounds.max} disabled={disabled} />
        </Field>
        <Field label="Address" required error={missing.has('address')}>
          <SmartAddressInput value={data.address} onChange={(v) => set({ ...data, address: v })} disabled={disabled} />
        </Field>
      </FormSection>

      <FormSection title="Home Environment">
        <Field label="Are there any pets in the home?" required error={missing.has('has_pets')}>
          <TriStateRadio name="has_pets" value={data.has_pets} onChange={(v) => set({ ...data, has_pets: v })} disabled={disabled} />
        </Field>
        <Field label="Is there smoking in the home?" required error={missing.has('has_smoking')}>
          <TriStateRadio name="has_smoking" value={data.has_smoking} onChange={(v) => set({ ...data, has_smoking: v })} disabled={disabled} />
        </Field>
      </FormSection>

      <FormSection title="Current Services">
        <Field label="Does the patient currently receive homecare services (LHCSA / CHHA / ABA)?" required error={missing.has('has_homecare_services')}>
          <TriStateRadio name="has_homecare_services" value={data.has_homecare_services} onChange={pickGate('has_homecare_services')} disabled={disabled} />
        </Field>
        {isYesLike(data.has_homecare_services) && (
          <>
            <Field label="Current Agency Name" required error={missing.has('homecare_agency_name')}>
              <TextInput value={data.homecare_agency_name} onChange={(v) => set({ ...data, homecare_agency_name: v })} disabled={disabled} />
            </Field>
            <Field label="Current Hours and Days of Service" required error={missing.has('homecare_hours_days')}>
              <TextArea rows={2} value={data.homecare_hours_days} onChange={(v) => set({ ...data, homecare_hours_days: v })} disabled={disabled} />
            </Field>
          </>
        )}
        <Field label="What BOE services does the patient currently receive?" required error={missing.has('boe_services')}>
          <TextArea rows={2} value={data.boe_services} onChange={(v) => set({ ...data, boe_services: v })} disabled={disabled} />
        </Field>
        <Field label="Does the patient currently receive community habilitation, respite, or reshab services?" required error={missing.has('has_community_hab')}>
          <TriStateRadio name="has_community_hab" value={data.has_community_hab} onChange={(v) => set({ ...data, has_community_hab: v })} disabled={disabled} />
        </Field>
      </FormSection>

      <FormSection title="Requested Services">
        <Field label="What services are being requested for the patient?" required error={missing.has('services_needed')}>
          <CheckboxGroup options={PEDIATRIC_SERVICES} values={data.services_needed} onChange={setServices} disabled={disabled} />
        </Field>
        {hasTherapy(data.services_needed) && (
          <Field label="Therapy Availability" required error={missing.has('therapy_availability')}>
            <TextArea rows={2} value={data.therapy_availability} onChange={(v) => set({ ...data, therapy_availability: v })} disabled={disabled} />
          </Field>
        )}
      </FormSection>

      <FormSection title="Clinical Information">
        <Field label="Any medical conditions or diagnoses?" required error={missing.has('health_conditions')}>
          <TextArea rows={3} value={data.health_conditions} onChange={(v) => set({ ...data, health_conditions: v })} disabled={disabled} />
        </Field>
        <Field label="What time does the child get home from school?" required error={missing.has('school_bus_time')}>
          <input type="time" value={data.school_bus_time || ''} onChange={(e) => set({ ...data, school_bus_time: e.target.value })} disabled={disabled} style={inputStyle} />
        </Field>
        <Field label="Any recent hospitalizations?" required error={missing.has('has_recent_hospitalization')}>
          <TriStateRadio name="has_recent_hospitalization" value={data.has_recent_hospitalization} onChange={(v) => set({ ...data, has_recent_hospitalization: v })} disabled={disabled} />
        </Field>
      </FormSection>

      <FormSection title="Primary Care Physician Information">
        <Field label="Primary Care Physician" required error={missing.has('pcp_name')}>
          <PhysicianPicker
            physicianId={null}
            physicianName={data.pcp_name}
            onChange={setPcp}
            readOnly={disabled}
            compact
          />
        </Field>
        <Field label="Date of Last PCP Visit" required error={missing.has('pcp_last_visit')}>
          <SmartDateInput value={data.pcp_last_visit} onChange={(v) => set({ ...data, pcp_last_visit: v })} max={new Date().toISOString().split('T')[0]} disabled={disabled} />
        </Field>
        <Field label="PCP Phone Number" required error={missing.has('pcp_phone')}>
          <SmartPhoneInput value={data.pcp_phone} onChange={(v) => set({ ...data, pcp_phone: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
        <Field label="PCP Fax Number" required error={missing.has('pcp_fax')}>
          <SmartPhoneInput value={data.pcp_fax} onChange={(v) => set({ ...data, pcp_fax: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
        <Field label="PCP Address" required error={missing.has('pcp_address')}>
          <SmartAddressInput value={data.pcp_address} onChange={(v) => set({ ...data, pcp_address: v })} disabled={disabled} />
        </Field>
      </FormSection>

      <FormSection title="Care Management">
        <Field label="CCO Name" required error={missing.has('cco_name')}>
          <SegmentedPicker value={data.cco_name || ''} options={CCO_OPTIONS} onChange={(v) => set({ ...data, cco_name: v })} disabled={disabled} />
        </Field>
        <Field label="Care Manager Name" required error={missing.has('cm_name')}>
          <TextInput value={data.cm_name} onChange={(v) => set({ ...data, cm_name: v })} disabled={disabled} />
        </Field>
        <Field label="Care Manager Phone Number" required error={missing.has('cm_phone')}>
          <SmartPhoneInput value={data.cm_phone} onChange={(v) => set({ ...data, cm_phone: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
        <Field label="Care Manager Fax Number" required error={missing.has('cm_fax')}>
          <SmartPhoneInput value={data.cm_fax} onChange={(v) => set({ ...data, cm_fax: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
        <Field label="Care Manager Email Address" required error={missing.has('cm_email')}>
          <SmartEmailInput value={data.cm_email} onChange={(v) => set({ ...data, cm_email: v })} disabled={disabled} forceValidate={forceValidate} />
        </Field>
      </FormSection>
    </>
  );
}

// ── Demographics auto-populate ──────────────────────────────────────────────

function buildDemographicSeed(patient, formType) {
  const fullName = `${patient?.first_name || ''} ${patient?.last_name || ''}`.trim();
  const addr = [patient?.address_street, patient?.address_city, patient?.address_state, patient?.address_zip]
    .filter(Boolean)
    .join(', ');
  const dob = patient?.dob ? String(patient.dob).split('T')[0] : '';
  const phoneDigits = String(patient?.phone_primary || '').replace(/\D/g, '').slice(0, 10);

  const seed = {
    patient_name: fullName,
    dob,
    address: addr,
    email: patient?.email || '',
    medicaid_number: patient?.medicaid_number || '',
  };
  if (formType === 'adult') {
    seed.insurance_plan_name = patient?.insurance_plan || '';
  } else {
    // Pediatric: emergency contact name + phone come from the patient record.
    const ecPhone = String(patient?.emergency_contact_phone || '').replace(/\D/g, '').slice(0, 10);
    if (patient?.emergency_contact_name) seed.emergency_contact_name = patient.emergency_contact_name;
    if (ecPhone)                          seed.emergency_contact_phone = ecPhone;
    if (patient?.phone_primary)           seed.primary_caregiver_phone = phoneDigits;
  }
  return seed;
}

// ── Main component ──────────────────────────────────────────────────────────

const SAVE_DEBOUNCE_MS = 700;

export default function TriageTab({ patient, referral, readOnly = false }) {
  const { user } = useUser();
  const { resolveUser } = useLookups();
  const { appUserId } = useCurrentAppUser();
  const { can } = usePermissions();

  // Determine which form: prefer the referral's explicit sn_age_group, else
  // derive from DOB. Special Needs only.
  const isSpecialNeeds = referral?.division === 'Special Needs' || patient?.division === 'Special Needs';
  const explicitAgeGroup = referral?.sn_age_group || null;
  const inferredAgeGroup = inferAgeGroupFromDob(patient?.dob);
  const ageGroup = explicitAgeGroup || inferredAgeGroup;
  const triageType = isSpecialNeeds ? (ageGroup === 'Pediatric' ? 'pediatric' : 'adult') : 'none';

  const getFn    = triageType === 'adult' ? getTriageAdult    : getTriagePediatric;
  const createFn = triageType === 'adult' ? createTriageAdult : createTriagePediatric;
  const updateFn = triageType === 'adult' ? updateTriageAdult : updateTriagePediatric;
  const BLANK    = triageType === 'adult' ? ADULT_BLANK       : PED_BLANK;
  const COLS     = triageType === 'adult' ? ADULT_COLUMNS     : PEDIATRIC_COLUMNS;

  const [data, setData] = useState(BLANK);
  const [recordId, setRecordId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(''); // 'Saving…' | 'Saved' | 'Save failed'
  const [filledByName, setFilledByName] = useState(null);
  const [filledAt, setFilledAt] = useState(null);
  const [filledBySelf, setFilledBySelf] = useState(false);
  const [opwddPendingPrompt, setOpwddPendingPrompt] = useState(null); // pending {next, prev}

  // Refs for the debounced save coordination.
  const saveTimer = useRef(null);
  const inFlight  = useRef(false);
  const pendingSaveData = useRef(null);
  const recordIdRef = useRef(null);
  recordIdRef.current = recordId;

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!referral?.id || triageType === 'none') { setLoading(false); return; }
    setLoading(true);
    let cancelled = false;
    getFn(referral.id)
      .then((records) => {
        if (cancelled) return;
        if (records.length) {
          const r = records[0];
          const normalized = normalizeIncoming(r.fields, BLANK);
          // Even on an existing record, fill in any still-blank demographics-
          // backed fields from the patient so users don't have to retype.
          const seed = buildDemographicSeed(patient, triageType);
          const merged = { ...normalized };
          for (const [k, v] of Object.entries(seed)) {
            if (!merged[k] || (typeof merged[k] === 'string' && merged[k].trim() === '')) {
              merged[k] = v;
            }
          }
          setData(merged);
          setRecordId(r.id);
          setFilledByName(resolveUser(r.fields.filled_by_id) || null);
          setFilledBySelf(r.fields.filled_by_id === appUserId || r.fields.filled_by_id === user?.id);
          setFilledAt(r.fields.updated_at || r.fields.created_at || null);
        } else {
          // Fresh record — seed everything we know from demographics.
          const seed = buildDemographicSeed(patient, triageType);
          setData({ ...BLANK, ...seed });
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
    // We intentionally only re-load when the referral or its type changes;
    // this is a single-document tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referral?.id, triageType]);

  // ── Debounced live-save ───────────────────────────────────────────────────

  function scheduleSave(nextData) {
    pendingSaveData.current = nextData;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }

  async function flushSave() {
    saveTimer.current = null;
    const payload = pendingSaveData.current;
    if (!payload || inFlight.current) return;
    if (!can(PERMISSION_KEYS.CLINICAL_TRIAGE)) return;
    if (!referral?.id) return;

    inFlight.current = true;
    setSavingStatus('Saving…');
    try {
      const fields = buildPayloadForSave(payload, COLS);
      fields.referral_id = referral.id;
      fields.updated_at  = new Date().toISOString();
      let saved;
      if (!recordIdRef.current) {
        fields.filled_by_id = appUserId || user?.id || 'unknown';
        fields.created_at   = new Date().toISOString();
        saved = await createFn(fields);
        setRecordId(saved.id);
        recordIdRef.current = saved.id;
        setFilledBySelf(true);
        setFilledByName(user?.fullName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || appUserId);
      } else {
        saved = await updateFn(recordIdRef.current, fields);
      }
      setFilledAt(saved?.fields?.updated_at || fields.updated_at);
      const storeKey = triageType === 'adult' ? 'triageAdult' : 'triagePediatric';
      mergeEntities(storeKey, { [saved.id]: { _id: saved.id, ...saved.fields } });
      setSavingStatus('Saved');
      setTimeout(() => setSavingStatus((s) => (s === 'Saved' ? '' : s)), 1800);
      // Refresh consumers (PatientDrawer tabComplete dot, snapshot, etc.)
      triggerDataRefresh();
    } catch (err) {
      console.error('[TriageTab] save failed:', err);
      setSavingStatus('Save failed — retrying on next change');
    } finally {
      inFlight.current = false;
      // If something changed mid-flight, re-flush.
      if (pendingSaveData.current && saveTimer.current === null) {
        const next = pendingSaveData.current;
        pendingSaveData.current = null;
        if (next !== payload) {
          pendingSaveData.current = next;
          scheduleSave(next);
        }
      }
    }
  }

  // Flush any pending save on unmount.
  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      flushSave();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── OPWDD status side-effects ─────────────────────────────────────────────

  async function applyOpwddRouting(nextStatus) {
    if (!referral?.id || !referral?._id) return;
    try {
      if (nextStatus === 'OPWDD Eligible') {
        await updateReferral(referral._id, { code_95: 'yes' }).catch(() => {});
      } else if (nextStatus === 'OPWDD Pending') {
        // Triage answer auto-routes the referral into OPWDD Enrollment — a
        // sanctioned system move through the shared engine.
        const result = attemptTransition({
          referral,
          toStage: 'OPWDD Enrollment',
          context: { system: true, actorUserId: appUserId, note: '[Triage: OPWDD Pending -> OPWDD Enrollment]', extraFields: { code_95: 'no' } },
        });
        if (result.allowed) await applyTransition({ referral, result, context: { actorUserId: appUserId } }).catch(() => {});
        await openCaseForReferral({
          referral: { id: referral.id, _id: referral._id },
          patientId: patient?.id,
          actorUserId: appUserId,
          assignedSpecialistId: appUserId,
          reason: 'triage_opwdd_pending',
        }).catch((err) => console.warn('Open OPWDD case failed:', err));
        triggerDataRefresh();
      } else if (nextStatus === 'Non-OPWDD') {
        // Keep code_95 consistent with "not on code 95" but DON'T trigger
        // the enrollment routing.
        await updateReferral(referral._id, { code_95: 'no' }).catch(() => {});
      }
    } catch (err) {
      console.warn('[TriageTab] applyOpwddRouting failed:', err);
    }
  }

  // ── Field change wrapper ──────────────────────────────────────────────────

  function handleChange(nextData) {
    // Detect OPWDD status flips → confirmation gate for 'OPWDD Pending'.
    const prevStatus = data.opwdd_status;
    const nextStatus = nextData.opwdd_status;
    setData(nextData);
    scheduleSave(nextData);

    if (nextStatus && nextStatus !== prevStatus) {
      if (nextStatus === 'OPWDD Pending' && prevStatus !== 'OPWDD Pending') {
        // Surface the routing prompt before triggering OPWDD enrollment.
        setOpwddPendingPrompt({ next: nextStatus, prev: prevStatus });
      } else {
        applyOpwddRouting(nextStatus);
      }
    }
  }

  function confirmOpwddPending() {
    if (!opwddPendingPrompt) return;
    applyOpwddRouting('OPWDD Pending');
    setOpwddPendingPrompt(null);
  }

  function declineOpwddPending() {
    if (!opwddPendingPrompt) return;
    // Revert OPWDD status to the previous value to avoid silent routing.
    const reverted = { ...data, opwdd_status: opwddPendingPrompt.prev || null };
    setData(reverted);
    scheduleSave(reverted);
    setOpwddPendingPrompt(null);
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const completeness = useMemo(
    () => (triageType === 'none' ? { complete: true, missing: [] } : isTriageComplete(data, triageType)),
    [data, triageType],
  );
  const missingSet = useMemo(() => new Set(completeness.missing), [completeness.missing]);
  const dobBounds  = useMemo(() => getDobBoundsForAgeGroup(ageGroup), [ageGroup]);
  const dobHint    = ageGroup
    ? `Locked to ${ageGroup} range (age ${ageGroup === 'Pediatric' ? 'under 18' : '18+'}).`
    : null;

  // ── Print ─────────────────────────────────────────────────────────────────

  function handlePrint() {
    const name = patient ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim() : 'Patient';
    const type = triageType === 'pediatric' ? 'Pediatric' : 'Adult';
    const win = window.open('', '_blank', 'width=800,height=900');
    const formEl = document.getElementById('triage-form-content');
    win.document.write(`
      <html><head><title>${type} Triage — ${name}</title>
      <style>
        body { font-family: -apple-system, sans-serif; padding: 32px; color: #0B0B10; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .meta { font-size: 12px; color: #777; margin-bottom: 24px; }
        label { display: block; font-size: 11px; font-weight: 600; color: #555; margin-top: 14px; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.05em; }
        p { font-size: 13px; margin: 0; padding: 6px 0; border-bottom: 1px solid #eee; }
        .section-title { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #999; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin-bottom: 10px; }
      </style></head><body>
      <h1>${type} Special Needs Triage Form</h1>
      <div class="meta">Patient: ${name}${filledByName ? ` · Filled by ${filledByName}` : ''}${filledAt ? ` · ${formatDateTime(filledAt)}` : ''}</div>
      ${formEl ? formEl.innerHTML : '<p>Form content unavailable.</p>'}
      </body></html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return <LoadingState message="Loading triage form..." size="small" />;
  if (triageType === 'none') {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: hexToRgba(palette.backgroundDark.hex, 0.4), fontSize: 13, paddingTop: 48, fontStyle: 'italic' }}>
        Triage forms are for Special Needs patients only.<br />This patient is classified as ALF.
      </div>
    );
  }

  const disabled = readOnly || !can(PERMISSION_KEYS.CLINICAL_TRIAGE);
  const displayName = filledBySelf
    ? (user?.fullName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || filledByName)
    : filledByName;
  const completionLabel = completeness.complete
    ? 'All required fields complete'
    : `${completeness.missing.length} required field${completeness.missing.length > 1 ? 's' : ''} remaining`;

  return (
    <div style={{ padding: '16px 20px 40px' }}>
      {displayName && (
        <FilledByRow
          name={displayName}
          date={filledAt}
          clerkImageUrl={filledBySelf ? user?.imageUrl : null}
          onPrint={handlePrint}
          savingStatus={savingStatus}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2 }}>
            {triageType === 'pediatric' ? 'Pediatric' : 'Adult'} Special Needs Triage Form
          </h3>
          <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
            Auto-saved · v2 spec
          </p>
        </div>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 999,
          background: completeness.complete
            ? hexToRgba('#16a34a', 0.1)
            : hexToRgba(palette.primaryMagenta.hex, 0.08),
          color: completeness.complete ? '#16a34a' : palette.primaryMagenta.hex,
          border: `1px solid ${hexToRgba(completeness.complete ? '#16a34a' : palette.primaryMagenta.hex, 0.25)}`,
          fontSize: 11.5, fontWeight: 700,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: completeness.complete ? '#16a34a' : palette.primaryMagenta.hex }} />
          {completionLabel}
        </div>
      </div>

      {!completeness.complete && completeness.missing.length > 0 && completeness.missing.length <= 8 && (
        <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, background: 'rgba(230,126,34,0.06)', border: '1px solid rgba(230,126,34,0.22)', fontSize: 11.5, color: '#9A4A07', lineHeight: 1.5 }}>
          Remaining: {completeness.missing.map((k) => k.replace(/^has_/, '').replace(/_/g, ' ')).join(', ')}
        </div>
      )}

      <div id="triage-form-content">
        {triageType === 'adult' ? (
          <AdultForm
            data={data}
            set={handleChange}
            missing={missingSet}
            dobBounds={dobBounds}
            dobHint={dobHint}
            disabled={disabled}
            forceValidate={false}
          />
        ) : (
          <PediatricForm
            data={data}
            set={handleChange}
            missing={missingSet}
            dobBounds={dobBounds}
            dobHint={dobHint}
            disabled={disabled}
            forceValidate={false}
          />
        )}
      </div>

      {opwddPendingPrompt && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) declineOpwddPending(); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: hexToRgba(palette.backgroundDark.hex, 0.5),
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, padding: 24, maxWidth: 460, boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.3)}` }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10, color: palette.backgroundDark.hex }}>Route to OPWDD Enrollment?</h3>
            <p style={{ fontSize: 13, lineHeight: 1.55, color: hexToRgba(palette.backgroundDark.hex, 0.75), marginBottom: 18 }}>
              Setting OPWDD Status to <strong>OPWDD Pending</strong> moves this patient to the OPWDD Enrollment module and opens an OPWDD eligibility case. They'll return to Intake once the OPWDD case is closed or converted.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={declineOpwddPending} style={{ padding: '8px 18px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.07), border: `1px solid var(--color-border)`, fontSize: 12.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.65), cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={confirmOpwddPending} style={{ padding: '8px 18px', borderRadius: 8, background: palette.primaryMagenta.hex, border: 'none', fontSize: 12.5, fontWeight: 700, color: palette.backgroundLight.hex, cursor: 'pointer' }}>
                Route to OPWDD Enrollment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
