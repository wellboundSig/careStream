import { useState, useEffect } from 'react';
import { useUser } from '@clerk/react';
import {
  getTriageAdult, createTriageAdult, updateTriageAdult,
  getTriagePediatric, createTriagePediatric, updateTriagePediatric,
} from '../../../api/triage.js';
import { updateReferral } from '../../../api/referrals.js';
import { mergeEntities } from '../../../store/careStore.js';
import { useLookups } from '../../../hooks/useLookups.js';
import { useCurrentAppUser } from '../../../hooks/useCurrentAppUser.js';
import PhysicianPicker from '../../physicians/PhysicianPicker.jsx';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

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

function Field({ label, required, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), marginBottom: 5 }}>
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

function AdultForm({ data, onChange, readOnly }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v });

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
      pcp_phone: data.pcp_phone || phy.phone || '',
      pcp_fax:   data.pcp_fax   || phy.fax   || '',
      pcp_address: data.pcp_address || addr,
    });
  }
  return (
    <>
      <FormSection title="Caregiver Information">
        <Field label="Caregiver Name"><TextInput value={data.caregiver_name} onChange={set('caregiver_name')} readOnly={readOnly} /></Field>
        <Field label="Caregiver Phone"><TextInput value={data.caregiver_phone} onChange={set('caregiver_phone')} type="tel" readOnly={readOnly} /></Field>
        <Field label="Caregiver Email"><TextInput value={data.caregiver_email} onChange={set('caregiver_email')} type="email" readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Home Environment">
        <Field label="Are there pets in the home?"><RadioGroup value={data.has_pets === true || data.has_pets === 'true' ? 'Yes' : data.has_pets === false || data.has_pets === 'false' ? 'No' : ''} onChange={(v) => set('has_pets')(v === 'Yes')} readOnly={readOnly} /></Field>
        {(data.has_pets === true || data.has_pets === 'true' || data.has_pets === 'Yes') && (
          <Field label="Pet Details"><TextInput value={data.pet_details} onChange={set('pet_details')} readOnly={readOnly} /></Field>
        )}
      </FormSection>
      <FormSection title="Existing Services">
        <Field label="Does the patient have homecare services (LHCSA / CHHA)?"><RadioGroup value={data.has_homecare_services === true || data.has_homecare_services === 'true' ? 'Yes' : data.has_homecare_services === false || data.has_homecare_services === 'false' ? 'No' : ''} onChange={(v) => set('has_homecare_services')(v === 'Yes')} readOnly={readOnly} /></Field>
        {(data.has_homecare_services === true || data.has_homecare_services === 'true') && (
          <>
            <Field label="Agency Name"><TextInput value={data.homecare_agency_name} onChange={set('homecare_agency_name')} readOnly={readOnly} /></Field>
            <Field label="Hours of Service"><TextInput value={data.homecare_hours} onChange={set('homecare_hours')} readOnly={readOnly} /></Field>
            <Field label="Days of Service"><TextInput value={data.homecare_days} onChange={set('homecare_days')} readOnly={readOnly} /></Field>
          </>
        )}
        <Field label="Community habilitation services?"><RadioGroup value={data.has_community_hab === true || data.has_community_hab === 'true' ? 'Yes' : data.has_community_hab === false || data.has_community_hab === 'false' ? 'No' : ''} onChange={(v) => set('has_community_hab')(v === 'Yes')} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Services Needed">
        <Field label="Services Needed"><CheckboxGroup options={['SN', 'PT', 'OT', 'ST', 'HHA']} values={data.services_needed} onChange={set('services_needed')} readOnly={readOnly} /></Field>
        <Field label="Therapy Availability"><TextArea value={data.therapy_availability} onChange={set('therapy_availability')} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Medical Information">
        <Field label="Is the patient diabetic?"><RadioGroup value={data.is_diabetic === true || data.is_diabetic === 'true' ? 'Yes' : data.is_diabetic === false || data.is_diabetic === 'false' ? 'No' : ''} onChange={(v) => set('is_diabetic')(v === 'Yes')} readOnly={readOnly} /></Field>
        {(data.is_diabetic === true || data.is_diabetic === 'true') && (
          <Field label="Who performs monitoring/treatment?"><TextInput value={data.diabetes_monitor_by} onChange={set('diabetes_monitor_by')} readOnly={readOnly} /></Field>
        )}
      </FormSection>
      <FormSection title="PCP Information">
        <Field label="PCP">
          <PhysicianPicker
            physicianId={data.pcp_physician_id}
            physicianName={data.pcp_name}
            onChange={handlePcpSelect}
            readOnly={readOnly}
            compact
          />
        </Field>
        <Field label="Date of Last PCP Visit"><TextInput value={data.pcp_last_visit ? data.pcp_last_visit.split('T')[0] : ''} onChange={set('pcp_last_visit')} type="date" readOnly={readOnly} /></Field>
        <Field label="PCP Phone"><TextInput value={data.pcp_phone} onChange={set('pcp_phone')} type="tel" readOnly={readOnly} /></Field>
        <Field label="PCP Fax"><TextInput value={data.pcp_fax} onChange={set('pcp_fax')} type="tel" readOnly={readOnly} /></Field>
        <Field label="PCP Address"><TextArea value={data.pcp_address} onChange={set('pcp_address')} rows={2} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Case Manager">
        <Field label="CM Name"><TextInput value={data.cm_name} onChange={set('cm_name')} readOnly={readOnly} /></Field>
        <Field label="Company"><TextInput value={data.cm_company} onChange={set('cm_company')} readOnly={readOnly} /></Field>
        <Field label="CM Phone"><TextInput value={data.cm_phone} onChange={set('cm_phone')} type="tel" readOnly={readOnly} /></Field>
        <Field label="CM Fax or Email"><TextInput value={data.cm_fax_or_email} onChange={set('cm_fax_or_email')} readOnly={readOnly} /></Field>
      </FormSection>
    </>
  );
}

function PediatricForm({ data, onChange, readOnly }) {
  const set = (k) => (v) => onChange({ ...data, [k]: v });

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
      pcp_phone: data.pcp_phone || phy.phone || '',
      pcp_fax:   data.pcp_fax   || phy.fax   || '',
      pcp_address: data.pcp_address || addr,
    });
  }
  return (
    <>
      <FormSection title="Intake Info">
        <Field label="Phone call made to"><TextInput value={data.phone_call_made_to} onChange={set('phone_call_made_to')} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Household">
        <Field label="Who does the patient live with?"><TextArea value={data.household_description} onChange={set('household_description')} rows={2} readOnly={readOnly} /></Field>
        <Field label="Pets in the home?"><RadioGroup value={data.has_pets === true || data.has_pets === 'true' ? 'Yes' : data.has_pets === false || data.has_pets === 'false' ? 'No' : ''} onChange={(v) => set('has_pets')(v === 'Yes')} readOnly={readOnly} /></Field>
        {(data.has_pets === true || data.has_pets === 'true') && (
          <Field label="Pet Details"><TextInput value={data.pet_details} onChange={set('pet_details')} readOnly={readOnly} /></Field>
        )}
      </FormSection>
      <FormSection title="Existing Services">
        <Field label="Does the patient have homecare services (LHCSA / CHHA / ABA)?"><RadioGroup value={data.has_homecare_services === true || data.has_homecare_services === 'true' ? 'Yes' : data.has_homecare_services === false || data.has_homecare_services === 'false' ? 'No' : ''} onChange={(v) => set('has_homecare_services')(v === 'Yes')} readOnly={readOnly} /></Field>
        {(data.has_homecare_services === true || data.has_homecare_services === 'true') && (
          <>
            <Field label="Agency Name"><TextInput value={data.homecare_agency_name} onChange={set('homecare_agency_name')} readOnly={readOnly} /></Field>
            <Field label="Hours of Service"><TextInput value={data.homecare_hours} onChange={set('homecare_hours')} readOnly={readOnly} /></Field>
            <Field label="Days of Service"><TextInput value={data.homecare_days} onChange={set('homecare_days')} readOnly={readOnly} /></Field>
          </>
        )}
        <Field label="BOE services currently received"><TextArea value={data.boe_services} onChange={set('boe_services')} rows={2} readOnly={readOnly} /></Field>
        <Field label="Community habilitation?"><RadioGroup value={data.has_community_hab === true || data.has_community_hab === 'true' ? 'Yes' : data.has_community_hab === false || data.has_community_hab === 'false' ? 'No' : ''} onChange={(v) => set('has_community_hab')(v === 'Yes')} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Services Needed">
        <Field label="Services Needed"><CheckboxGroup options={['SN', 'PT', 'OT', 'ST', 'ABA']} values={data.services_needed} onChange={set('services_needed')} readOnly={readOnly} /></Field>
        <Field label="Therapy Availability"><TextArea value={data.therapy_availability} onChange={set('therapy_availability')} readOnly={readOnly} /></Field>
        <Field label="HHA Hours and Frequency"><TextInput value={data.hha_hours_frequency} onChange={set('hha_hours_frequency')} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Medical">
        <Field label="Is the patient diabetic?"><RadioGroup value={data.is_diabetic === true || data.is_diabetic === 'true' ? 'Yes' : data.is_diabetic === false || data.is_diabetic === 'false' ? 'No' : ''} onChange={(v) => set('is_diabetic')(v === 'Yes')} readOnly={readOnly} /></Field>
        {(data.is_diabetic === true || data.is_diabetic === 'true') && (
          <Field label="Who performs monitoring/treatment?"><TextInput value={data.diabetes_monitor_by} onChange={set('diabetes_monitor_by')} readOnly={readOnly} /></Field>
        )}
        <Field label="Immunizations up to date?"><RadioGroup value={data.immunizations_up_to_date === true || data.immunizations_up_to_date === 'true' ? 'Yes' : data.immunizations_up_to_date === false || data.immunizations_up_to_date === 'false' ? 'No' : ''} onChange={(v) => set('immunizations_up_to_date')(v === 'Yes')} readOnly={readOnly} /></Field>
        <Field label="What time does the patient get off the school bus?"><TextInput value={data.school_bus_time} onChange={set('school_bus_time')} type="time" readOnly={readOnly} /></Field>
        <Field label="Any recent hospitalization"><TextArea value={data.recent_hospitalization} onChange={set('recent_hospitalization')} rows={2} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="PCP Information">
        <Field label="PCP">
          <PhysicianPicker
            physicianId={data.pcp_physician_id}
            physicianName={data.pcp_name}
            onChange={handlePcpSelect}
            readOnly={readOnly}
            compact
          />
        </Field>
        <Field label="Date of Last PCP Visit"><TextInput value={data.pcp_last_visit ? data.pcp_last_visit.split('T')[0] : ''} onChange={set('pcp_last_visit')} type="date" readOnly={readOnly} /></Field>
        <Field label="PCP Phone"><TextInput value={data.pcp_phone} onChange={set('pcp_phone')} type="tel" readOnly={readOnly} /></Field>
        <Field label="PCP Fax"><TextInput value={data.pcp_fax} onChange={set('pcp_fax')} type="tel" readOnly={readOnly} /></Field>
        <Field label="PCP Address"><TextArea value={data.pcp_address} onChange={set('pcp_address')} rows={2} readOnly={readOnly} /></Field>
      </FormSection>
      <FormSection title="Case Manager">
        <Field label="CM Name"><TextInput value={data.cm_name} onChange={set('cm_name')} readOnly={readOnly} /></Field>
        <Field label="CM Company"><TextInput value={data.cm_company} onChange={set('cm_company')} readOnly={readOnly} /></Field>
        <Field label="CM Phone"><TextInput value={data.cm_phone} onChange={set('cm_phone')} type="tel" readOnly={readOnly} /></Field>
        <Field label="Potential SOC Date"><TextInput value={data.potential_soc_date ? data.potential_soc_date.split('T')[0] : ''} onChange={set('potential_soc_date')} type="date" readOnly={readOnly} /></Field>
      </FormSection>
    </>
  );
}

export default function TriageTab({ patient, referral }) {
  const { user } = useUser();
  const { resolveUser } = useLookups();
  const { appUserId } = useCurrentAppUser();
  const [triageData, setTriageData] = useState({});
  const [triageRecordId, setTriageRecordId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [draft, setDraft] = useState({});

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
          setTriageData({ ...r.fields });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [referral?.id, triageType]);

  function startEdit() {
    setDraft({ ...triageData });
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      // Strip virtual/local fields that don't exist as Airtable columns
      // eslint-disable-next-line no-unused-vars
      const { pcp_physician_id, ...triageFields } = draft;
      const rawFields = {
        ...triageFields,
        referral_id: referral.id,
        filled_by_id: user?.id || 'unknown',
        updated_at: new Date().toISOString(),
      };
      // Airtable checkbox fields accept real booleans; text-backed boolean fields need "TRUE"/"FALSE".
      // has_pets, has_homecare_services, has_community_hab, is_diabetic are checkboxes → boolean
      // immunizations_up_to_date is a text field in Airtable that stores "TRUE"/"FALSE" → string
      const CHECKBOX_FIELDS = new Set([
        'has_pets', 'has_homecare_services', 'has_community_hab', 'is_diabetic',
      ]);
      const TEXT_BOOL_FIELDS = new Set(['immunizations_up_to_date']);

      const fields = Object.fromEntries(
        Object.entries(rawFields)
          .map(([k, v]) => {
            if (CHECKBOX_FIELDS.has(k)) {
              return [k, v === true || (typeof v === 'string' && v.toLowerCase() === 'true')];
            }
            if (TEXT_BOOL_FIELDS.has(k)) {
              const isTrue = v === true || v === 'Yes' || (typeof v === 'string' && v.toLowerCase() === 'true');
              return [k, isTrue ? 'TRUE' : 'FALSE'];
            }
            if (typeof v === 'string' && v.toLowerCase() === 'true')  return [k, true];
            if (typeof v === 'string' && v.toLowerCase() === 'false') return [k, false];
            return [k, v];
          })
          .filter(([, v]) => v !== false && v !== null && v !== undefined)
      );
      const storeKey = triageType === 'adult' ? 'triageAdult' : 'triagePediatric';
      if (triageRecordId) {
        await updateFn(triageRecordId, fields);
        mergeEntities(storeKey, { [triageRecordId]: { _id: triageRecordId, ...fields } });
      } else {
        const prefix = triageType === 'pediatric' ? 'tri_p' : 'tri_a';
        const newId = `${prefix}_${Date.now()}`;
        const created = await createFn({ id: newId, ...fields, created_at: new Date().toISOString() });
        setTriageRecordId(created.id);
        mergeEntities(storeKey, { [created.id]: { _id: created.id, ...created.fields } });
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
      // Preserve pcp_physician_id in local state (it's not persisted on the triage record)
      setTriageData({ ...triageFields, pcp_physician_id });
      setEditing(false);
    } catch (err) {
      setSaveError(err.message || 'Save failed. Please try again.');
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

  const currentData = editing ? draft : triageData;
  const hasData = Object.keys(triageData).length > 0;
  const filledByName = triageData.filled_by_id ? resolveUser(triageData.filled_by_id) : null;
  const filledAt = triageData.updated_at || triageData.created_at;

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
          isCurrentUser={triageData.filled_by_id === appUserId}
          clerkImageUrl={triageData.filled_by_id === appUserId ? user?.imageUrl : null}
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
          <button onClick={startEdit} style={{ padding: '6px 16px', borderRadius: 7, background: palette.primaryMagenta.hex, border: 'none', fontSize: 12, fontWeight: 650, color: palette.backgroundLight.hex, cursor: 'pointer' }}>
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

      <div id="triage-form-content">
        {triageType === 'adult' ? (
          <AdultForm data={currentData} onChange={editing ? setDraft : () => {}} readOnly={!editing} />
        ) : (
          <PediatricForm data={currentData} onChange={editing ? setDraft : () => {}} readOnly={!editing} />
        )}
      </div>

      {/* Bottom save bar — visible when editing so the user doesn't scroll back up */}
      {editing && (
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
