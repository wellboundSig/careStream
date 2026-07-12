import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCareStore, mergeEntities } from '../../store/careStore.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import {
  updateInboundSubmission,
  logInboundEvent,
} from '../../api/inboundSubmissions.js';
import { parsedToFormPrefill } from '../../lib/inboundParse.js';
import ParseSuggestionChips from '../../components/inbound/ParseSuggestionChips.jsx';
import NewReferralForm from '../../components/forms/NewReferralForm.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

function readParsed(sub) {
  if (!sub?.parsed) return null;
  if (typeof sub.parsed === 'object') return sub.parsed;
  try { return JSON.parse(sub.parsed); } catch { return null; }
}

function sanitizeBasicHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

export default function InboundConvertWorkspace() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const mode = params.get('mode') === 'referral' ? 'referral' : 'lead';
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { appUserId } = useCurrentAppUser();
  const storeSubs = useCareStore((s) => s.inboundSubmissions);

  const needPerm = mode === 'referral'
    ? PERMISSION_KEYS.INBOUND_CONVERT_REFERRAL
    : PERMISSION_KEYS.INBOUND_CONVERT_LEAD;

  const sub = useMemo(
    () => Object.values(storeSubs || {}).find((s) => s.id === id || s._id === id) || null,
    [storeSubs, id],
  );

  const parsed = readParsed(sub);
  const [formOverrides, setFormOverrides] = useState({});
  const [marking, setMarking] = useState(false);

  const initialForm = useMemo(() => {
    const base = parsedToFormPrefill(parsed);
    // Strip internal hints that aren't form fields
    const { _facility_hint, ...rest } = base;
    return { ...rest, ...formOverrides };
  }, [parsed, formOverrides]);

  const forceStage = mode === 'referral' ? 'Intake' : 'Lead Entry';

  // Mark converting once when workspace opens (hooks must run before early returns)
  useEffect(() => {
    if (!sub?._id) return;
    if (sub.status === 'converting' || sub.status === 'converted') return;
    let cancelled = false;
    (async () => {
      const now = new Date().toISOString();
      const fields = { status: 'converting', updated_at: now };
      try {
        await updateInboundSubmission(sub._id, fields);
        if (cancelled) return;
        mergeEntities('inboundSubmissions', { [sub._id]: { ...sub, ...fields } });
        await logInboundEvent({
          submissionId: sub.id, actorId: appUserId, action: 'convert_started',
          detail: `Started convert to ${mode}`,
        });
      } catch { /* */ }
    })();
    return () => { cancelled = true; };
  }, [sub?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!can(needPerm)) {
    return (
      <div style={{ padding: 48 }}>
        <p>You do not have permission to convert this submission to a {mode}.</p>
        <button type="button" onClick={() => navigate(-1)}>Back</button>
      </div>
    );
  }

  if (!sub) {
    return (
      <div style={{ padding: 28 }}>
        <p>Submission not found.</p>
        <button type="button" onClick={() => navigate('/inbound-submissions')}>Back</button>
      </div>
    );
  }

  if (sub.status === 'converted') {
    return (
      <div style={{ padding: 28 }}>
        <p>Already converted to {sub.converted_referral_id}.</p>
        <button type="button" onClick={() => navigate(`/inbound-submissions/${sub.id}`)}>Back to ticket</button>
      </div>
    );
  }

  function applyChip(field, value) {
    const map = {
      patient_first: 'first_name',
      patient_last: 'last_name',
      patient_name: null,
      dob: 'dob',
      phone: 'phone_primary',
    };
    if (field === 'patient_name') {
      const parts = String(value).split(',');
      if (parts.length >= 2) {
        setFormOverrides((p) => ({
          ...p,
          last_name: parts[0].trim(),
          first_name: parts.slice(1).join(',').trim(),
        }));
      } else {
        const bits = String(value).trim().split(/\s+/);
        setFormOverrides((p) => ({
          ...p,
          first_name: bits[0] || '',
          last_name: bits.slice(1).join(' ') || '',
        }));
      }
      return;
    }
    const formKey = map[field];
    if (formKey) setFormOverrides((p) => ({ ...p, [formKey]: value }));
  }

  async function onCreated({ patient, referral }) {
    setMarking(true);
    const now = new Date().toISOString();
    const fields = {
      status: 'converted',
      convert_mode: mode,
      converted_patient_id: patient?.id || '',
      converted_referral_id: referral?.id || '',
      converted_by_id: appUserId || '',
      converted_at: now,
      updated_at: now,
    };
    try {
      await updateInboundSubmission(sub._id, fields);
      mergeEntities('inboundSubmissions', { [sub._id]: { ...sub, ...fields } });
      await logInboundEvent({
        submissionId: sub.id,
        actorId: appUserId,
        action: 'converted',
        detail: `Converted to ${mode}: ${referral?.id}`,
        metadata: { patient_id: patient?.id, referral_id: referral?.id, mode },
      });
    } catch (e) {
      console.error('Failed to mark submission converted', e);
    } finally {
      setMarking(false);
      navigate(`/inbound-submissions/${sub.id}`);
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => navigate(`/inbound-submissions/${sub.id}`)}
          style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'none', fontWeight: 600, cursor: 'pointer' }}
        >
          ← Cancel
        </button>
        <div>
          <p style={{ fontSize: 14, fontWeight: 700, color: palette.backgroundDark.hex }}>
            {mode === 'referral' ? 'Convert to Referral (Intake)' : 'Convert to Lead (Lead Entry)'}
          </p>
          <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
            Email on the left · form on the right. Sender is the referrer, not the patient.
            {marking ? ' · Saving…' : ''}
          </p>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) minmax(360px, 1.1fr)', gap: 0 }}>
        {/* Email pane */}
        <div style={{ borderRight: '1px solid var(--color-border)', overflow: 'auto', padding: 16, background: hexToRgba(palette.backgroundDark.hex, 0.02) }}>
          <div style={{ padding: '10px 12px', borderRadius: 8, background: hexToRgba(palette.accentBlue.hex, 0.1), marginBottom: 12 }}>
            <p style={{ fontSize: 10, fontWeight: 750, letterSpacing: '0.05em', textTransform: 'uppercase', color: palette.accentBlue.hex }}>Sender / referrer</p>
            <p style={{ fontSize: 14, fontWeight: 650 }}>{sub.from_name || '—'}</p>
            <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.5) }}>{sub.from_email}</p>
          </div>
          <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{sub.subject || '(no subject)'}</p>
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 6 }}>
              Click a chip to apply to the form
            </p>
            <ParseSuggestionChips parsed={parsed} onApply={applyChip} />
          </div>
          {sub.body_html ? (
            <div
              style={{ fontSize: 13, lineHeight: 1.5 }}
              dangerouslySetInnerHTML={{ __html: sanitizeBasicHtml(sub.body_html) }}
            />
          ) : (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.5 }}>
              {sub.body_text || ''}
            </pre>
          )}
        </div>

        {/* Form pane */}
        <div style={{ overflow: 'hidden', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <NewReferralForm
            key={JSON.stringify(initialForm)}
            embedded
            forceStage={forceStage}
            initialForm={initialForm}
            title={mode === 'referral' ? 'Convert to Referral' : 'Convert to Lead'}
            subtitle={mode === 'referral' ? 'Creates patient + Intake referral' : 'Creates patient + Lead Entry referral'}
            onClose={() => navigate(`/inbound-submissions/${sub.id}`)}
            onSuccess={onCreated}
          />
        </div>
      </div>
    </div>
  );
}
