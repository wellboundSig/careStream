import { useState, useEffect } from 'react';
import { useUser } from '@clerk/react';
import {
  getTriageAdult, createTriageAdult, updateTriageAdult,
  getTriagePediatric, createTriagePediatric, updateTriagePediatric,
} from '../../../api/triage.js';
import LoadingState from '../../common/LoadingState.jsx';
import palette, { hexToRgba } from '../../../utils/colors.js';

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
        <Field label="PCP Name"><TextInput value={data.pcp_name} onChange={set('pcp_name')} readOnly={readOnly} /></Field>
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
        <Field label="PCP Name"><TextInput value={data.pcp_name} onChange={set('pcp_name')} readOnly={readOnly} /></Field>
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
  const [triageData, setTriageData] = useState({});
  const [triageRecordId, setTriageRecordId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
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
    try {
      const fields = {
        ...draft,
        referral_id: referral.id,
        filled_by_id: user?.id || 'unknown',
        updated_at: new Date().toISOString(),
      };
      if (triageRecordId) {
        await updateFn(triageRecordId, fields);
      } else {
        const created = await createFn({ ...fields, created_at: new Date().toISOString() });
        setTriageRecordId(created.id);
      }
      setTriageData(draft);
      setEditing(false);
    } catch {
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

  return (
    <div style={{ padding: '16px 20px 40px' }}>
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

      {triageType === 'adult' ? (
        <AdultForm data={currentData} onChange={editing ? setDraft : () => {}} readOnly={!editing} />
      ) : (
        <PediatricForm data={currentData} onChange={editing ? setDraft : () => {}} readOnly={!editing} />
      )}
    </div>
  );
}
