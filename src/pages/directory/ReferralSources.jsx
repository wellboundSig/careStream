import { useState, useMemo } from 'react';
import { useCareStore, mergeEntities } from '../../store/careStore.js';
import { useLookups } from '../../hooks/useLookups.js';
import { SkeletonTableRow } from '../../components/common/Skeleton.jsx';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import { createReferralSource, updateReferralSource } from '../../api/referralSources.js';
import AccessDenied from '../../components/common/AccessDenied.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const SOURCE_TYPES = ['Hospital', 'SNF', 'MD/PCP', 'ALF', 'Web', 'Fax', 'Allscripts', 'Campaign', 'Self-Referral', 'Other'];

const TYPE_COLORS = {
  Hospital: hexToRgba(palette.primaryMagenta.hex, 0.15),
  SNF: hexToRgba(palette.accentOrange.hex, 0.15),
  'MD/PCP': hexToRgba(palette.accentGreen.hex, 0.15),
  ALF: hexToRgba(palette.highlightYellow.hex, 0.2),
  Web: hexToRgba(palette.accentBlue.hex, 0.14),
  Fax: hexToRgba(palette.backgroundDark.hex, 0.08),
  Allscripts: hexToRgba(palette.accentBlue.hex, 0.12),
  Campaign: hexToRgba(palette.primaryMagenta.hex, 0.1),
  'Self-Referral': hexToRgba(palette.accentGreen.hex, 0.12),
  Other: hexToRgba(palette.backgroundDark.hex, 0.07),
};

export default function ReferralSources() {
  const storeSources = useCareStore((s) => s.referralSources);
  const storeRefs = useCareStore((s) => s.referrals);
  const storeMarketers = useCareStore((s) => s.marketers);
  const hydrated = useCareStore((s) => s.hydrated);
  const { resolveMarketer } = useLookups();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const sources = useMemo(() => Object.values(storeSources), [storeSources]);
  const marketers = useMemo(() => Object.values(storeMarketers).filter((m) => m.status === 'Active' || !m.status).sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')), [storeMarketers]);
  const refData = useMemo(() => Object.values(storeRefs), [storeRefs]);

  const enriched = useMemo(() => {
    const list = search.trim()
      ? sources.filter((s) => (s.name || '').toLowerCase().includes(search.toLowerCase()) || (s.type || '').toLowerCase().includes(search.toLowerCase()) || (resolveMarketer(s.marketer_id) || '').toLowerCase().includes(search.toLowerCase()))
      : sources;
    return list.map((src) => {
      const refs = refData.filter((r) => r.referral_source_id === src.id);
      const admitted = refs.filter((r) => r.current_stage === 'SOC Completed').length;
      const convRate = refs.length ? Math.round((admitted / refs.length) * 100) : 0;
      return { ...src, refCount: refs.length, admitted, convRate };
    }).sort((a, b) => b.refCount - a.refCount);
  }, [sources, refData, search, resolveMarketer]);

  const { can } = usePermissions();
  if (!can(PERMISSION_KEYS.DIRECTORY_VIEW)) return <AccessDenied message="You do not have permission to view the directory." />;

  async function handleCreate(fields) {
    const rec = await createReferralSource(fields);
    mergeEntities('referralSources', { [rec.id]: { _id: rec.id, ...rec.fields } });
    setShowCreate(false);
  }

  async function handleUpdate(src, fields) {
    await updateReferralSource(src._id, fields);
    mergeEntities('referralSources', { [src._id]: { ...src, ...fields } });
    setEditingId(null);
  }

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Referral Sources</h1>
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{enriched.length} sources</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: '1px solid var(--color-border)', borderRadius: 8, padding: '0 12px', height: 34, width: 220 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search sources…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
          </div>
          {can(PERMISSION_KEYS.DIRECTORY_CREATE) && (
            <button onClick={() => setShowCreate(true)} style={{ height: 34, padding: '0 16px', borderRadius: 8, background: palette.primaryDeepPlum.hex, border: 'none', fontSize: 13, fontWeight: 650, color: '#fff', cursor: 'pointer' }}>+ Add Source</button>
          )}
        </div>
      </div>

      {showCreate && <SourceForm marketers={marketers} onSave={handleCreate} onCancel={() => setShowCreate(false)} />}

      <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: '1px solid var(--color-border)' }}>
              {['Source', 'Type', 'Marketer', 'Referrals', 'Admissions', 'Conversion', ''].map((h) => (
                <th key={h} style={{ padding: '9px 14px', textAlign: h === '' ? 'right' : 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!hydrated ? (
              Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} columns={7} />)
            ) : enriched.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.35), fontStyle: 'italic' }}>No sources found.</td></tr>
            ) : enriched.map((src) => {
              if (editingId === src.id) {
                return (
                  <tr key={src._id}><td colSpan={7} style={{ padding: 0 }}>
                    <SourceForm initial={src} marketers={marketers} onSave={(fields) => handleUpdate(src, fields)} onCancel={() => setEditingId(null)} inline />
                  </td></tr>
                );
              }
              return <SourceRow key={src._id} source={src} resolveMarketer={resolveMarketer} onEdit={() => setEditingId(src.id)} canEdit={can(PERMISSION_KEYS.DIRECTORY_EDIT)} />;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourceRow({ source: src, resolveMarketer, onEdit, canEdit }) {
  const [hov, setHov] = useState(false);
  const typeBg = TYPE_COLORS[src.type] || TYPE_COLORS.Other;
  const marketerName = resolveMarketer(src.marketer_id);
  const isUnassigned = !src.marketer_id;
  return (
    <tr onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`, background: hov ? hexToRgba(palette.primaryDeepPlum.hex, 0.025) : 'transparent', transition: 'background 0.1s' }}>
      <td style={{ padding: '11px 14px', fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex }}>{src.name}</td>
      <td style={{ padding: '11px 14px' }}>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 9px', borderRadius: 20, background: typeBg, color: palette.backgroundDark.hex }}>{src.type || '—'}</span>
      </td>
      <td style={{ padding: '11px 14px', fontSize: 12.5, color: isUnassigned ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.6), fontWeight: isUnassigned ? 600 : 400, fontStyle: isUnassigned ? 'italic' : 'normal' }}>
        {isUnassigned ? 'Unassigned' : marketerName}
      </td>
      <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: src.refCount > 0 ? 650 : 400, color: src.refCount > 0 ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.3), textAlign: 'center' }}>{src.refCount}</td>
      <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: src.admitted > 0 ? 650 : 400, color: src.admitted > 0 ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.3), textAlign: 'center' }}>{src.admitted}</td>
      <td style={{ padding: '11px 14px', textAlign: 'center' }}>
        {src.refCount > 0 ? <span style={{ fontSize: 13, fontWeight: 650, color: src.convRate >= 50 ? palette.accentGreen.hex : src.convRate >= 25 ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.45) }}>{src.convRate}%</span>
        : <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.25) }}>—</span>}
      </td>
      <td style={{ padding: '11px 14px', textAlign: 'right' }}>
        {canEdit && hov && <button onClick={onEdit} style={{ padding: '4px 10px', borderRadius: 5, background: hexToRgba(palette.backgroundDark.hex, 0.05), border: 'none', fontSize: 11, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer' }}>Edit</button>}
      </td>
    </tr>
  );
}

function SourceForm({ initial, marketers, onSave, onCancel, inline }) {
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState(initial?.type || '');
  const [marketerId, setMarketerId] = useState(initial?.marketer_id || '');
  const [saving, setSaving] = useState(false);
  const canSubmit = name.trim() && type && !saving;

  const inp = { width: '100%', padding: '9px 12px', borderRadius: 8, border: 'none', fontSize: 13, fontFamily: 'inherit', outline: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.05), color: palette.backgroundDark.hex, boxSizing: 'border-box' };

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const fields = {
        name: name.trim(), type,
        ...(marketerId && { marketer_id: marketerId }),
        ...(!initial && { id: `src_${Date.now().toString(36)}` }),
      };
      await onSave(fields);
    } catch { setSaving(false); }
  }

  return (
    <div style={{ padding: inline ? '14px 16px' : '18px 20px', borderRadius: inline ? 0 : 12, background: hexToRgba(palette.backgroundDark.hex, 0.02), marginBottom: inline ? 0 : 16 }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: palette.primaryDeepPlum.hex, marginBottom: 12 }}>{initial ? 'Edit Source' : 'New Referral Source'}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 14px', marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Source Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. George St Martin's Hospital" style={inp} autoFocus />
        </div>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Type *</label>
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
            <option value="">Select type…</option>
            {SOURCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Assigned Marketer</label>
          <select value={marketerId} onChange={(e) => setMarketerId(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
            <option value="">Unassigned</option>
            {marketers.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ padding: '7px 16px', borderRadius: 7, background: hexToRgba(palette.backgroundDark.hex, 0.05), border: 'none', fontSize: 12.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer' }}>Cancel</button>
        <button onClick={handleSubmit} disabled={!canSubmit} style={{ padding: '7px 20px', borderRadius: 7, background: canSubmit ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.08), border: 'none', fontSize: 12.5, fontWeight: 650, color: canSubmit ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.3), cursor: canSubmit ? 'pointer' : 'not-allowed' }}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
