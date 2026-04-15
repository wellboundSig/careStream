import { useState, useEffect } from 'react';
import { useUser } from '@clerk/react';
import {
  getTriageAdult, createTriageAdult, updateTriageAdult,
  getTriagePediatric, createTriagePediatric, updateTriagePediatric,
} from '../../../api/triage.js';
import { updateReferral } from '../../../api/referrals.js';
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
import { normalizePhone, formatPhone, validateEmail } from '../../../utils/validation.js';

function formatDateTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' + new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function getInitials(name) {
  return (name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function FilledByRow({ name, date, isCurrentUser, clerkImageUrl, onPrint }) {
  const initials = getInitials(name);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, paddingBottom: 16, borderBottom: `1px solid var(--color-border)` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Avatar */}
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

      {/* Print button */}
      <button
        onClick={onPrint}
        title="Print / Export PDF"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 8, background: 'none', border: 'none', color: hexToRgba(palette.backgroundDark.hex, 0.4), cursor: 'pointer', transition: 'color 0.12s, background 0.12s' }}
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
  );
}

function calcAge(dob) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
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

function Field({ label, required, error, children }) {
  return (
    <div style={error ? { borderLeft: `2px solid ${palette.primaryMagenta.hex}`, paddingLeft: 8 } : undefined}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: error ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.6), marginBottom: 5 }}>
        {label} {required && <span style={{ color: palette.primaryMagenta.hex }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '8px 10px', borderRadius: 7,
  border: `1px solid var(--color-border)`,
  background: hexToRgba(palette.backgroundDark.hex, 0.03),
  fontSize: 13, color: palette.backgroundDark.hex,
  outline: 'none', fontFamily: 'inherit',
};

function TextInput({ value, onChange, placeholder, type = 'text', readOnly }) {
  return (
    <input type={type} value={value || ''} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} readOnly={readOnly}
      style={{ ...inputStyle, background: readOnly ? hexToRgba(palette.backgroundDark.hex, 0.04) : inputStyle.background }}
      onFocus={(e) => !readOnly && (e.target.style.borderColor = palette.primaryMagenta.hex)}
      onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.1))}
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 3, readOnly }) {
  return (
    <textarea value={value || ''} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} rows={rows} readOnly={readOnly}
      style={{ ...inputStyle, resize: 'vertical', background: readOnly ? hexToRgba(palette.backgroundDark.hex, 0.04) : inputStyle.background }}
      onFocus={(e) => !readOnly && (e.target.style.borderColor = palette.primaryMagenta.hex)}
      onBlur={(e) => (e.target.style.borderColor = hexToRgba(palette.backgroundDark.hex, 0.1))}
    />
  );
}

function RadioGroup({ value, onChange, readOnly }) {
  return (
    <div style={{ display: 'flex', gap: 16 }}>
      {['Yes', 'No'].map((opt) => (
        <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: readOnly ? 'default' : 'pointer', fontSize: 13 }}>
          <input type="radio" value={opt} checked={value === opt} onChange={() => !readOnly && onChange(opt)} style={{ accentColor: palette.primaryMagenta.hex }} />
          {opt}
        </label>
      ))}
    </div>
  );
}

function CheckboxGroup({ options, values = [], onChange, readOnly }) {
  function toggle(opt) {
    if (readOnly) return;
    const arr = Array.isArray(values) ? values : [];
    const next = arr.includes(opt) ? arr.filter((v) => v !== opt) : [...arr, opt];
    onChange(next);
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
      {options.map((opt) => (
        <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: readOnly ? 'default' : 'pointer', fontSize: 13 }}>
          <input type="checkbox" checked={(values || []).includes(opt)} onChange={() => toggle(opt)} style={{ accentColor: palette.primaryMagenta.hex }} />
          {opt}
        </label>
      ))}
    </div>
  );
}

// Convert tri-state boolean (true/false/null) to RadioGroup value ('Yes'/'No'/'')
function boolToRadio(val) {
  if (val === true || val === 'true' || val === 'TRUE' || val === 'Yes') return 'Yes';
  if (val === false || val === 'false' || val === 'FALSE' || val === 'No') return 'No';
  return ''; // unanswered
}

// Check if a value is truthy for conditional field display
function isTruthyVal(val) {
  return val === true || val === 'true' || val === 'TRUE' || val === 'Yes';
}

function hasEmailError(val) {
  if (!val || !val.trim()) return false;
  if (val.trim().length < 3) return true;
  return !validateEmail(val).valid;
}

function AdultForm({ data, onChange, readOnly, missingFields }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v });
  const phoneSet = (k) => (v) => onChange({ ...data, [k]: v.replace(/\D/g, '').slice(0, 10) });

  function handlePcpSelect(phy) {
    if (!phy) {
      onChange({ ...data, pcp_physician_id: null });
      return;
    }
    const addr = [phy.address_street, phy.address_city, phy.address_state, phy.address_zip].filter(Boolean).join(', ');
    onChange({
      ...data,
      pcp_physician_id: phy.id,
      pcp_name: `Dr. ${phy.first_name || ''} ${phy.last_name || ''}`.trim(),
      pcp_phone: phy.phone || data.pcp_phone || '',
      pcp_fax:   phy.fax   || data.pcp_fax   || '',
      pcp_address: addr || data.pcp_address || '',
    });
  }
  return (
    <>
      <FormSection title="Caregiver Information">
        <Field label="Caregiver Name" required error={missingFields?.has('caregiver_name')}><TextInput value={data.caregiver_name} onChange={set('caregiver_name')} readOnly={readOnly} /></Field>
        <Field label="Caregiver Phone" required error={missingFields?.has('caregiver_phone')}><TextInput value={readOnly ? formatPhone(data.caregiver_phone) : data.caregiver_phone} onChange={phoneSet('caregiver_phone')} type="tel" readOnly={readOnly} /></Field>
        <Field label="Caregiver Email" required error={missingFields?.has('caregiver_email') || hasEmailError(data.caregiver_email)}><TextInput value={data.caregiver_email} onChange={set('caregiver_email')} type="email" readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Home Environment">
        <Field label="Are there pets in the home?" required error={missingFields?.has('has_pets')}><RadioGroup value={boolToRadio(data.has_pets)} onChange={(v) => set('has_pets')(v)} readOnly={readOnly} /></Field>
        {isTruthyVal(data.has_pets) && (
          <Field label="Pet Details" error={missingFields?.has('pet_details')}><TextInput value={data.pet_details} onChange={set('pet_details')} readOnly={readOnly} /></Field>
        )}
      </FormSection>
      <FormSection title="Existing Services">
        <Field label="Does the patient have homecare services (LHCSA / CHHA)?" required error={missingFields?.has('has_homecare_services')}><RadioGroup value={boolToRadio(data.has_homecare_services)} onChange={(v) => set('has_homecare_services')(v)} readOnly={readOnly} /></Field>
        {isTruthyVal(data.has_homecare_services) && (
          <>
            <Field label="Agency Name" error={missingFields?.has('homecare_agency_name')}><TextInput value={data.homecare_agency_name} onChange={set('homecare_agency_name')} readOnly={readOnly} /></Field>
            <Field label="Hours of Service" error={missingFields?.has('homecare_hours')}><TextInput value={data.homecare_hours} onChange={set('homecare_hours')} readOnly={readOnly} /></Field>
            <Field label="Days of Service" error={missingFields?.has('homecare_days')}><TextInput value={data.homecare_days} onChange={set('homecare_days')} readOnly={readOnly} /></Field>
          </>
        )}
        <Field label="Community habilitation services?" required error={missingFields?.has('has_community_hab')}><RadioGroup value={boolToRadio(data.has_community_hab)} onChange={(v) => set('has_community_hab')(v)} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Services Needed">
        <Field label="Code 95 (OPWDD)" required error={missingFields?.has('code_95')}>
          {readOnly ? (
            <span style={{ fontSize: 13, color: palette.backgroundDark.hex }}>{data.code_95 === 'yes' ? 'Yes' : data.code_95 === 'no' ? 'No' : '—'}</span>
          ) : (
            <select
              value={data.code_95 || ''}
              onChange={(e) => set('code_95')(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="" disabled>Select...</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          )}
        </Field>
        <Field label="Services Needed" required error={missingFields?.has('services_needed')}><CheckboxGroup options={['SN', 'PT', 'OT', 'ST', 'HHA']} values={data.services_needed} onChange={set('services_needed')} readOnly={readOnly} /></Field>
        <Field label="Therapy Availability" required error={missingFields?.has('therapy_availability')}><TextArea value={data.therapy_availability} onChange={set('therapy_availability')} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Medical Information">
        <Field label="Is the patient diabetic?" required error={missingFields?.has('is_diabetic')}><RadioGroup value={boolToRadio(data.is_diabetic)} onChange={(v) => set('is_diabetic')(v)} readOnly={readOnly} /></Field>
        {isTruthyVal(data.is_diabetic) && (
          <Field label="Who performs monitoring/treatment?" error={missingFields?.has('diabetes_monitor_by')}><TextInput value={data.diabetes_monitor_by} onChange={set('diabetes_monitor_by')} readOnly={readOnly} /></Field>
        )}
      </FormSection>
      <FormSection title="PCP Information">
        <Field label="PCP" required error={missingFields?.has('pcp_name')}>
          <PhysicianPicker
            physicianId={data.pcp_physician_id}
            physicianName={data.pcp_name}
            onChange={handlePcpSelect}
            readOnly={readOnly}
            compact
          />
        </Field>
        <Field label="Date of Last PCP Visit" required error={missingFields?.has('pcp_last_visit')}><TextInput value={data.pcp_last_visit ? data.pcp_last_visit.split('T')[0] : ''} onChange={set('pcp_last_visit')} type="date" readOnly={readOnly} /></Field>
        <Field label="PCP Phone" required error={missingFields?.has('pcp_phone')}><TextInput value={readOnly ? formatPhone(data.pcp_phone) : data.pcp_phone} onChange={phoneSet('pcp_phone')} type="tel" readOnly={readOnly} /></Field>
        <Field label="PCP Fax" required error={missingFields?.has('pcp_fax')}><TextInput value={readOnly ? formatPhone(data.pcp_fax) : data.pcp_fax} onChange={phoneSet('pcp_fax')} type="tel" readOnly={readOnly} /></Field>
        <Field label="PCP Address" required error={missingFields?.has('pcp_address')}><TextArea value={data.pcp_address} onChange={set('pcp_address')} rows={2} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Case Manager">
        <Field label="CM Name" required error={missingFields?.has('cm_name')}><TextInput value={data.cm_name} onChange={set('cm_name')} readOnly={readOnly} /></Field>
        <Field label="Company" required error={missingFields?.has('cm_company')}><TextInput value={data.cm_company} onChange={set('cm_company')} readOnly={readOnly} /></Field>
        <Field label="CM Phone" required error={missingFields?.has('cm_phone')}><TextInput value={readOnly ? formatPhone(data.cm_phone) : data.cm_phone} onChange={phoneSet('cm_phone')} type="tel" readOnly={readOnly} /></Field>
        <Field label="CM Fax or Email" required error={missingFields?.has('cm_fax_or_email') || (data.cm_fax_or_email?.includes('@') && hasEmailError(data.cm_fax_or_email))}><TextInput value={data.cm_fax_or_email} onChange={set('cm_fax_or_email')} readOnly={readOnly} /></Field>
      </FormSection>
    </>
  );
}

function PediatricForm({ data, onChange, readOnly, missingFields }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v });
  const phoneSet = (k) => (v) => onChange({ ...data, [k]: v.replace(/\D/g, '').slice(0, 10) });

  function handlePcpSelect(phy) {
    if (!phy) {
      onChange({ ...data, pcp_physician_id: null });
      return;
    }
    const addr = [phy.address_street, phy.address_city, phy.address_state, phy.address_zip].filter(Boolean).join(', ');
    onChange({
      ...data,
      pcp_physician_id: phy.id,
      pcp_name: `Dr. ${phy.first_name || ''} ${phy.last_name || ''}`.trim(),
      pcp_phone: phy.phone || data.pcp_phone || '',
      pcp_fax:   phy.fax   || data.pcp_fax   || '',
      pcp_address: addr || data.pcp_address || '',
    });
  }
  return (
    <>
      <FormSection title="Intake Info">
        <Field label="Phone call made to" required error={missingFields?.has('phone_call_made_to')}><TextInput value={data.phone_call_made_to} onChange={set('phone_call_made_to')} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Household">
        <Field label="Who does the patient live with?" required error={missingFields?.has('household_description')}><TextArea value={data.household_description} onChange={set('household_description')} rows={2} readOnly={readOnly} /></Field>
        <Field label="Pets in the home?" required error={missingFields?.has('has_pets')}><RadioGroup value={boolToRadio(data.has_pets)} onChange={(v) => set('has_pets')(v)} readOnly={readOnly} /></Field>
        {isTruthyVal(data.has_pets) && (
          <Field label="Pet Details" error={missingFields?.has('pet_details')}><TextInput value={data.pet_details} onChange={set('pet_details')} readOnly={readOnly} /></Field>
        )}
      </FormSection>
      <FormSection title="Existing Services">
        <Field label="Does the patient have homecare services (LHCSA / CHHA / ABA)?" required error={missingFields?.has('has_homecare_services')}><RadioGroup value={boolToRadio(data.has_homecare_services)} onChange={(v) => set('has_homecare_services')(v)} readOnly={readOnly} /></Field>
        {isTruthyVal(data.has_homecare_services) && (
          <>
            <Field label="Agency Name" error={missingFields?.has('homecare_agency_name')}><TextInput value={data.homecare_agency_name} onChange={set('homecare_agency_name')} readOnly={readOnly} /></Field>
            <Field label="Hours of Service" error={missingFields?.has('homecare_hours')}><TextInput value={data.homecare_hours} onChange={set('homecare_hours')} readOnly={readOnly} /></Field>
            <Field label="Days of Service" error={missingFields?.has('homecare_days')}><TextInput value={data.homecare_days} onChange={set('homecare_days')} readOnly={readOnly} /></Field>
          </>
        )}
        <Field label="Does the patient receive BOE services?" required error={missingFields?.has('has_boe_services')}><RadioGroup value={boolToRadio(data.has_boe_services)} onChange={(v) => set('has_boe_services')(v)} readOnly={readOnly} /></Field>
        {isTruthyVal(data.has_boe_services) && (
          <Field label="BOE Services Details" error={missingFields?.has('boe_services')}><TextArea value={data.boe_services} onChange={set('boe_services')} rows={2} readOnly={readOnly} /></Field>
        )}
        <Field label="Community habilitation?" required error={missingFields?.has('has_community_hab')}><RadioGroup value={boolToRadio(data.has_community_hab)} onChange={(v) => set('has_community_hab')(v)} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Services Needed">
        <Field label="Code 95 (OPWDD)" required error={missingFields?.has('code_95')}>
          {readOnly ? (
            <span style={{ fontSize: 13, color: palette.backgroundDark.hex }}>{data.code_95 === 'yes' ? 'Yes' : data.code_95 === 'no' ? 'No' : '—'}</span>
          ) : (
            <select
              value={data.code_95 || ''}
              onChange={(e) => set('code_95')(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="" disabled>Select...</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          )}
        </Field>
        <Field label="Services Needed" required error={missingFields?.has('services_needed')}><CheckboxGroup options={['SN', 'PT', 'OT', 'ST', 'ABA']} values={data.services_needed} onChange={set('services_needed')} readOnly={readOnly} /></Field>
        <Field label="Therapy Availability" required error={missingFields?.has('therapy_availability')}><TextArea value={data.therapy_availability} onChange={set('therapy_availability')} readOnly={readOnly} /></Field>
        <Field label="HHA Hours and Frequency" required error={missingFields?.has('hha_hours_frequency')}><TextInput value={data.hha_hours_frequency} onChange={set('hha_hours_frequency')} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Medical">
        <Field label="Is the patient diabetic?" required error={missingFields?.has('is_diabetic')}><RadioGroup value={boolToRadio(data.is_diabetic)} onChange={(v) => set('is_diabetic')(v)} readOnly={readOnly} /></Field>
        {isTruthyVal(data.is_diabetic) && (
          <Field label="Who performs monitoring/treatment?" error={missingFields?.has('diabetes_monitor_by')}><TextInput value={data.diabetes_monitor_by} onChange={set('diabetes_monitor_by')} readOnly={readOnly} /></Field>
        )}
        <Field label="Immunizations up to date?" required error={missingFields?.has('immunizations_up_to_date')}><RadioGroup value={boolToRadio(data.immunizations_up_to_date)} onChange={(v) => set('immunizations_up_to_date')(v)} readOnly={readOnly} /></Field>
        <Field label="What time does the patient get off the school bus?" required error={missingFields?.has('school_bus_time')}><TextInput value={data.school_bus_time} onChange={set('school_bus_time')} type="time" readOnly={readOnly} /></Field>
        <Field label="Any recent hospitalization?" required error={missingFields?.has('has_recent_hospitalization')}><RadioGroup value={boolToRadio(data.has_recent_hospitalization)} onChange={(v) => set('has_recent_hospitalization')(v)} readOnly={readOnly} /></Field>
        {isTruthyVal(data.has_recent_hospitalization) && (
          <Field label="Hospitalization Note" error={missingFields?.has('hospitalization_note')}><TextArea value={data.hospitalization_note} onChange={set('hospitalization_note')} rows={2} readOnly={readOnly} /></Field>
        )}
      </FormSection>
      <FormSection title="PCP Information">
        <Field label="PCP" required error={missingFields?.has('pcp_name')}>
          <PhysicianPicker
            physicianId={data.pcp_physician_id}
            physicianName={data.pcp_name}
            onChange={handlePcpSelect}
            readOnly={readOnly}
            compact
          />
        </Field>
        <Field label="Date of Last PCP Visit" required error={missingFields?.has('pcp_last_visit')}><TextInput value={data.pcp_last_visit ? data.pcp_last_visit.split('T')[0] : ''} onChange={set('pcp_last_visit')} type="date" readOnly={readOnly} /></Field>
        <Field label="PCP Phone" required error={missingFields?.has('pcp_phone')}><TextInput value={readOnly ? formatPhone(data.pcp_phone) : data.pcp_phone} onChange={phoneSet('pcp_phone')} type="tel" readOnly={readOnly} /></Field>
        <Field label="PCP Fax" required error={missingFields?.has('pcp_fax')}><TextInput value={readOnly ? formatPhone(data.pcp_fax) : data.pcp_fax} onChange={phoneSet('pcp_fax')} type="tel" readOnly={readOnly} /></Field>
        <Field label="PCP Address" required error={missingFields?.has('pcp_address')}><TextArea value={data.pcp_address} onChange={set('pcp_address')} rows={2} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Case Manager">
        <Field label="CM Name" required error={missingFields?.has('cm_name')}><TextInput value={data.cm_name} onChange={set('cm_name')} readOnly={readOnly} /></Field>
        <Field label="CM Phone" required error={missingFields?.has('cm_phone')}><TextInput value={readOnly ? formatPhone(data.cm_phone) : data.cm_phone} onChange={phoneSet('cm_phone')} type="tel" readOnly={readOnly} /></Field>
        <Field label="Potential SOC Date"><TextInput value={data.potential_soc_date ? data.potential_soc_date.split('T')[0] : ''} onChange={set('potential_soc_date')} type="date" readOnly={readOnly} /></Field>
      </FormSection>
    </>
  );
}

export default function TriageTab({ patient, referral, readOnly = false }) {
  const { user } = useUser();
  const { resolveUser } = useLookups();
  const { appUserId } = useCurrentAppUser();
  const { can } = usePermissions();
  const [triageData, setTriageData] = useState({});
  const [triageRecordId, setTriageRecordId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [draft, setDraft] = useState({});
  const [validationWarnings, setValidationWarnings] = useState([]);

  const isSpecialNeeds = referral?.division === 'Special Needs' || patient?.division === 'Special Needs';
  const age = calcAge(patient?.dob);
  const isPediatric = age !== null && age < 18;
  const triageType = isSpecialNeeds ? (isPediatric ? 'pediatric' : 'adult') : 'none';

  const getFn = triageType === 'adult' ? getTriageAdult : getTriagePediatric;
  const createFn = triageType === 'adult' ? createTriageAdult : createTriagePediatric;
  const updateFn = triageType === 'adult' ? updateTriageAdult : updateTriagePediatric;

  useEffect(() => {
    if (!referral?.id || triageType === 'none') { setLoading(false); return; }
    setLoading(true);
    getFn(referral.id)
      .then((records) => {
        if (records.length) {
          const r = records[0];
          setTriageRecordId(r.id);
          setTriageData({ ...r.fields, code_95: r.fields.code_95 || referral?.code_95 || '' });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [referral?.id, triageType]);

  function startEdit() {
    if (readOnly) return;
    setDraft({ ...triageData, code_95: triageData.code_95 || referral?.code_95 || '' });
    setValidationWarnings([]);
    setEditing(true);
  }

  async function save() {
    if (!can(PERMISSION_KEYS.CLINICAL_TRIAGE)) return;
    const { missing } = isTriageComplete(draft, triageType);
    setValidationWarnings(missing);

    const phoneErrors = [];
    const PHONE_CHECK = ['caregiver_phone', 'pcp_phone', 'pcp_fax', 'cm_phone'];
    for (const pf of PHONE_CHECK) {
      if (draft[pf] && draft[pf].replace(/\D/g, '').length > 0) {
        const r = normalizePhone(draft[pf]);
        if (!r.valid) phoneErrors.push(pf);
      }
    }
    const emailErrors = [];
    const EMAIL_CHECK = ['caregiver_email'];
    for (const ef of EMAIL_CHECK) {
      if (draft[ef] && draft[ef].trim()) {
        const r = validateEmail(draft[ef]);
        if (!r.valid) emailErrors.push(ef);
      }
    }
    if (draft.cm_fax_or_email && draft.cm_fax_or_email.trim() && draft.cm_fax_or_email.includes('@')) {
      const r = validateEmail(draft.cm_fax_or_email);
      if (!r.valid) emailErrors.push('cm_fax_or_email');
    }
    if (phoneErrors.length > 0 || emailErrors.length > 0) {
      const allBad = [...phoneErrors, ...emailErrors];
      setValidationWarnings([...missing, ...allBad.filter((f) => !missing.includes(f))]);
      setSaveError(`Fix invalid fields: ${allBad.map((f) => f.replace(/_/g, ' ')).join(', ')}`);
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const pcp_physician_id = draft.pcp_physician_id;

      // Whitelist: ONLY send fields that actually exist as Airtable columns.
      // Sending unknown fields causes Airtable to reject the ENTIRE update.
      const ADULT_COLUMNS = new Set([
        'id', 'referral_id', 'filled_by_id',
        'caregiver_name', 'caregiver_phone', 'caregiver_email',
        'has_pets', 'pet_details',
        'has_homecare_services', 'homecare_agency_name', 'homecare_hours', 'homecare_days',
        'has_community_hab',
        'services_needed', 'therapy_availability',
        'is_diabetic', 'diabetes_monitor_by',
        'pcp_name', 'pcp_last_visit', 'pcp_phone', 'pcp_fax', 'pcp_address',
        'cm_name', 'cm_company', 'cm_phone', 'cm_fax_or_email',
        'created_at', 'updated_at',
      ]);
      const PEDIATRIC_COLUMNS = new Set([
        'id', 'referral_id', 'filled_by_id',
        'phone_call_made_to', 'household_description',
        'has_pets', 'pet_details',
        'has_homecare_services', 'homecare_agency_name', 'homecare_hours', 'homecare_days',
        'boe_services', 'has_boe_services', 'has_community_hab',
        'services_needed', 'therapy_availability', 'hha_hours_frequency',
        'is_diabetic', 'diabetes_monitor_by',
        'immunizations_up_to_date', 'school_bus_time',
        'has_recent_hospitalization', 'recent_hospitalization', 'hospitalization_note',
        'pcp_name', 'pcp_last_visit', 'pcp_phone', 'pcp_fax', 'pcp_address',
        'cm_name', 'cm_company', 'cm_phone', 'potential_soc_date',
        'created_at', 'updated_at',
      ]);
      const ALLOWED = triageType === 'adult' ? ADULT_COLUMNS : PEDIATRIC_COLUMNS;

      const BOOL_FIELDS = new Set([
        'has_pets', 'has_homecare_services', 'has_community_hab', 'is_diabetic',
        'immunizations_up_to_date',
        ...(triageType === 'pediatric' ? ['has_recent_hospitalization', 'has_boe_services'] : []),
      ]);
      const DATE_FIELDS = new Set(['pcp_last_visit', 'potential_soc_date', 'created_at', 'updated_at']);

      // Normalize phones
      for (const pf of PHONE_CHECK) {
        if (draft[pf]) {
          const result = normalizePhone(draft[pf]);
          draft[pf] = result.valid ? result.digits : draft[pf].replace(/\D/g, '');
        }
      }

      const fields = {};
      for (const [k, v] of Object.entries(draft)) {
        if (!ALLOWED.has(k)) continue;
        if (v === null || v === undefined) continue;
        if (typeof v === 'string' && v.trim() === '' && DATE_FIELDS.has(k)) continue;
        if (Array.isArray(v) && v.length === 0) continue;
        if (BOOL_FIELDS.has(k)) {
          if (v === true || v === 'Yes' || (typeof v === 'string' && v.toLowerCase() === 'true')) {
            fields[k] = 'TRUE';
          } else if (v === false || v === 'No' || (typeof v === 'string' && v.toLowerCase() === 'false')) {
            fields[k] = 'FALSE';
          }
          continue;
        }
        fields[k] = v;
      }

      fields.referral_id = referral.id;
      fields.updated_at = new Date().toISOString();
      if (!triageRecordId) {
        fields.filled_by_id = appUserId || user?.id || 'unknown';
        fields.created_at = new Date().toISOString();
      }

      // Store record: will be replaced with actual Airtable response after save
      let storeRecord = { ...fields };
      for (const bf of BOOL_FIELDS) {
        if (storeRecord[bf] === 'TRUE') storeRecord[bf] = true;
        else if (storeRecord[bf] === 'FALSE') storeRecord[bf] = false;
        // else: leave as undefined (unanswered)
      }

      console.log('[TriageTab] Saving', Object.keys(fields).length, 'fields');

      const storeKey = triageType === 'adult' ? 'triageAdult' : 'triagePediatric';
      let savedRecord;
      if (triageRecordId) {
        savedRecord = await updateFn(triageRecordId, fields);
        
        // Use the actual response from Airtable — this is the truth
        const merged = { _id: triageRecordId, ...savedRecord.fields };
        mergeEntities(storeKey, { [triageRecordId]: merged });
        storeRecord = { ...merged };
      } else {
        savedRecord = await createFn(fields);
        
        setTriageRecordId(savedRecord.id);
        const merged = { _id: savedRecord.id, ...savedRecord.fields };
        mergeEntities(storeKey, { [savedRecord.id]: merged });
        storeRecord = { ...merged };
      }
      // Sync services_needed → referral.services_requested when the referral has none yet.
      // This keeps the pipeline card's service tags populated from the triage assessment.
      const existingServices = referral?.services_requested;
      const needsServiceSync =
        draft.services_needed?.length > 0 &&
        referral?._id &&
        (!existingServices || (Array.isArray(existingServices) && existingServices.length === 0));
      if (needsServiceSync) {
        await updateReferral(referral._id, { services_requested: draft.services_needed }).catch(() => {});
      }
      // If a physician was newly linked, sync to the referral record
      if (pcp_physician_id && pcp_physician_id !== triageData.pcp_physician_id && referral?._id) {
        await updateReferral(referral._id, { physician_id: pcp_physician_id }).catch(() => {});
      }
      // If Code 95 = no, route patient to OPWDD Enrollment
      if (draft.code_95 === 'no' && referral?._id) {
        await updateReferral(referral._id, { current_stage: 'OPWDD Enrollment', code_95: 'no' }).catch(() => {});
        triggerDataRefresh();
      } else if (draft.code_95 === 'yes' && referral?._id) {
        await updateReferral(referral._id, { code_95: 'yes' }).catch(() => {});
      }

      // Re-fetch from DB to get the real persisted data
      const reloaded = await getFn(referral.id);
      if (reloaded.length) {
        const fresh = reloaded[0];
        const freshData = { ...fresh.fields, code_95: draft.code_95 || referral?.code_95 || '', pcp_physician_id };
        setTriageData(freshData);
        mergeEntities(storeKey, { [fresh.id]: { _id: fresh.id, ...fresh.fields } });
      } else {
        setTriageData({ ...storeRecord, pcp_physician_id, code_95: draft.code_95 || '' });
      }
      setEditing(false);
      triggerDataRefresh();
    } catch (err) {
      console.error('[TriageTab] Save failed:', err, err?.stack);
      const msg = err?.message || 'Save failed';
      setSaveError(`Save error: ${msg}. Check browser console for details.`);
      window.alert?.(`Triage save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingState message="Loading triage form..." size="small" />;

  if (triageType === 'none') {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: hexToRgba(palette.backgroundDark.hex, 0.4), fontSize: 13, paddingTop: 48, fontStyle: 'italic' }}>
        Triage forms are for Special Needs patients only.<br />This patient is classified as ALF.
      </div>
    );
  }

  const currentData = editing ? draft : { ...triageData, code_95: triageData.code_95 || referral?.code_95 || '' };
  const hasData = Object.keys(triageData).length > 0;
  const isFilledByCurrentUser = triageData.filled_by_id && (triageData.filled_by_id === appUserId || triageData.filled_by_id === user?.id);
  const resolvedFilledBy = triageData.filled_by_id ? resolveUser(triageData.filled_by_id) : null;
  const filledByName = isFilledByCurrentUser
    ? (user?.fullName || `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || resolvedFilledBy)
    : resolvedFilledBy;
  const filledAt = triageData.updated_at || triageData.created_at;
  const validationWarningSet = new Set(validationWarnings);

  function handlePrint() {
    const name = patient ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim() : 'Patient';
    const type = isPediatric ? 'Pediatric' : 'Adult';
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
        .section { margin-bottom: 20px; }
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

  return (
    <div style={{ padding: '16px 20px 40px' }}>
      {/* Filled-by row */}
      {hasData && !editing && filledByName && (
        <FilledByRow
          name={filledByName}
          date={filledAt}
          isCurrentUser={isFilledByCurrentUser}
          clerkImageUrl={isFilledByCurrentUser ? user?.imageUrl : null}
          onPrint={handlePrint}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 650, color: palette.backgroundDark.hex, marginBottom: 2 }}>
            {isPediatric ? 'Pediatric' : 'Adult'} Special Needs Triage Form
          </h3>
          {hasData && !editing && (
            <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
              Read-only — click Edit to modify
            </p>
          )}
        </div>
        {!editing ? (
          !readOnly && can(PERMISSION_KEYS.CLINICAL_TRIAGE) && <button onClick={startEdit} style={{ padding: '6px 16px', borderRadius: 7, background: palette.primaryMagenta.hex, border: 'none', fontSize: 12, fontWeight: 650, color: palette.backgroundLight.hex, cursor: 'pointer' }}>
            {hasData ? 'Edit' : 'Fill Out'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setEditing(false)} style={{ padding: '6px 14px', borderRadius: 7, background: hexToRgba(palette.backgroundDark.hex, 0.07), border: `1px solid var(--color-border)`, fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={save} disabled={saving} style={{ padding: '6px 16px', borderRadius: 7, background: palette.primaryMagenta.hex, border: 'none', fontSize: 12, fontWeight: 650, color: palette.backgroundLight.hex, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {saveError && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: hexToRgba(palette.primaryMagenta.hex, 0.08), border: `1px solid ${hexToRgba(palette.primaryMagenta.hex, 0.3)}`, fontSize: 12.5, color: palette.primaryMagenta.hex, lineHeight: 1.5 }}>
          {saveError}
        </div>
      )}

      {validationWarnings.length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 8, background: 'rgba(230,126,34,0.08)', border: '1px solid rgba(230,126,34,0.3)', fontSize: 12.5, color: '#B7590A', lineHeight: 1.5 }}>
          <strong>{validationWarnings.length} required field{validationWarnings.length > 1 ? 's' : ''} incomplete:</strong>{' '}
          {validationWarnings.map((k) => k.replace(/^has_/, '').replace(/_/g, ' ')).join(', ')}
        </div>
      )}

      <div id="triage-form-content">
        {triageType === 'adult' ? (
          <AdultForm data={currentData} onChange={editing ? setDraft : () => {}} readOnly={!editing} missingFields={validationWarningSet} />
        ) : (
          <PediatricForm data={currentData} onChange={editing ? setDraft : () => {}} readOnly={!editing} missingFields={validationWarningSet} />
        )}
      </div>

      {/* Bottom save bar — visible when editing so the user doesn't scroll back up */}
      {editing && !readOnly && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24, paddingTop: 16, borderTop: `1px solid var(--color-border)` }}>
          {saveError && (
            <p style={{ flex: 1, fontSize: 12, color: palette.primaryMagenta.hex, alignSelf: 'center' }}>{saveError}</p>
          )}
          <button onClick={() => { setEditing(false); setSaveError(null); }} style={{ padding: '8px 18px', borderRadius: 7, background: hexToRgba(palette.backgroundDark.hex, 0.07), border: `1px solid var(--color-border)`, fontSize: 12.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving} style={{ padding: '8px 24px', borderRadius: 7, background: palette.primaryMagenta.hex, border: 'none', fontSize: 12.5, fontWeight: 650, color: palette.backgroundLight.hex, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : 'Save Form'}
          </button>
        </div>
      )}
    </div>
  );
}
