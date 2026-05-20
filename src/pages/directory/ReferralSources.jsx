import { useState, useMemo } from 'react';
import { useCareStore, mergeEntities } from '../../store/careStore.js';
import { useLookups } from '../../hooks/useLookups.js';
import { SkeletonTableRow } from '../../components/common/Skeleton.jsx';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import { createReferralSource, updateReferralSource } from '../../api/referralSources.js';
import AccessDenied from '../../components/common/AccessDenied.jsx';
import { useDirectoryDrawer } from '../../context/DirectoryDrawerContext.jsx';
import SourceFormModal from '../../components/referralSources/SourceFormModal.jsx';
import { SOURCE_TYPES, TYPE_COLORS } from '../../components/referralSources/sourceConstants.js';
import palette, { hexToRgba } from '../../utils/colors.js';

// A "Referral Source" is the PERSON who refers (care manager, discharge planner,
// PCP, etc.). Each person sits under a category/type (Hospital, CCO, PCP, etc.)
// and works for a company/entity (e.g. Tri-County Care). All three pieces feed
// the New Referral picker so users can choose a person and have the type and
// company auto-fill alongside.
//
// Communication methods (Web / Fax / Allscripts) intentionally do NOT live
// here — those are *how* a person sent us a referral, not *what* they are.

function TypeBadge({ type }) {
  const c = TYPE_COLORS[type] || TYPE_COLORS.Other;
  return (
    <span style={{ fontSize: 11.5, fontWeight: 650, padding: '2px 9px', borderRadius: 20, background: c.bg, color: c.text, whiteSpace: 'nowrap' }}>
      {type || '—'}
    </span>
  );
}

export default function ReferralSources() {
  const storeSources    = useCareStore((s) => s.referralSources);
  const storeRefs       = useCareStore((s) => s.referrals);
  const storeMarketers  = useCareStore((s) => s.marketers);
  const hydrated        = useCareStore((s) => s.hydrated);
  const { resolveMarketer } = useLookups();
  const { openReferralSource } = useDirectoryDrawer();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [modal, setModal] = useState(null); // { mode: 'create' } | { mode: 'edit', source }

  const sources = useMemo(() => Object.values(storeSources), [storeSources]);
  const marketers = useMemo(
    () =>
      Object.values(storeMarketers)
        .filter((m) => m.status === 'Active' || !m.status)
        .sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')),
    [storeMarketers],
  );
  const refData = useMemo(() => Object.values(storeRefs), [storeRefs]);

  const enriched = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = sources;
    if (typeFilter !== 'all') list = list.filter((s) => s.type === typeFilter);
    if (q) {
      list = list.filter(
        (s) =>
          (s.name || '').toLowerCase().includes(q) ||
          (s.type || '').toLowerCase().includes(q) ||
          (s.source_entity || '').toLowerCase().includes(q) ||
          (resolveMarketer(s.marketer_id) || '').toLowerCase().includes(q),
      );
    }
    return list
      .map((src) => {
        const refs = refData.filter((r) => r.referral_source_id === src.id);
        const admitted = refs.filter((r) => r.current_stage === 'SOC Completed').length;
        const convRate = refs.length ? Math.round((admitted / refs.length) * 100) : 0;
        return { ...src, refCount: refs.length, admitted, convRate };
      })
      .sort((a, b) => b.refCount - a.refCount);
  }, [sources, refData, search, resolveMarketer, typeFilter]);

  // Distinct type chips for the toolbar filter row
  const availableTypes = useMemo(() => {
    const set = new Set(sources.map((s) => s.type).filter(Boolean));
    return SOURCE_TYPES.filter((t) => set.has(t));
  }, [sources]);

  const { can } = usePermissions();
  if (!can(PERMISSION_KEYS.DIRECTORY_VIEW)) {
    return <AccessDenied message="You do not have permission to view the directory." />;
  }

  async function handleCreate(fields) {
    const rec = await createReferralSource(fields);
    mergeEntities('referralSources', { [rec.id]: { _id: rec.id, ...rec.fields } });
    setModal(null);
  }

  async function handleUpdate(src, fields) {
    await updateReferralSource(src._id, fields);
    mergeEntities('referralSources', { [src._id]: { ...src, ...fields } });
    setModal(null);
  }

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 6, gap: 14, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Referral Sources</h1>
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), maxWidth: 580 }}>
            The people who refer patients to us: care managers, discharge planners, PCPs, and so on.
            Each row is one person paired with a category and the company they work for.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: '1px solid var(--color-border)', borderRadius: 8, padding: '0 12px', height: 34, width: 240 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8"/>
              <path d="m21 21-4.35-4.35" stroke={hexToRgba(palette.backgroundDark.hex, 0.35)} strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search person, company, type…"
              style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }}
            />
          </div>
          {can(PERMISSION_KEYS.DIRECTORY_CREATE) && (
            <button
              onClick={() => setModal({ mode: 'create' })}
              style={{ height: 34, padding: '0 16px', borderRadius: 8, background: palette.primaryDeepPlum.hex, border: 'none', fontSize: 13, fontWeight: 650, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'transform 0.12s, background 0.12s' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = palette.primaryMagenta.hex)}
              onMouseLeave={(e) => (e.currentTarget.style.background = palette.primaryDeepPlum.hex)}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"/></svg>
              Add Source
            </button>
          )}
        </div>
      </div>

      {/* Filter chips + count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '12px 0 16px' }}>
        <button
          onClick={() => setTypeFilter('all')}
          style={chipStyle(typeFilter === 'all')}
        >
          All
        </button>
        {availableTypes.map((t) => (
          <button
            key={t}
            onClick={() => setTypeFilter(t === typeFilter ? 'all' : t)}
            style={chipStyle(typeFilter === t)}
          >
            {t}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
          {enriched.length} {enriched.length === 1 ? 'source' : 'sources'}
        </p>
      </div>

      <div style={{ background: palette.backgroundLight.hex, borderRadius: 12, border: '1px solid var(--color-border)', overflow: 'hidden', boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.04)}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.025), borderBottom: '1px solid var(--color-border)' }}>
              {['Person', 'Type', 'Company / Entity', 'Marketer', 'Referrals', 'Admissions', 'Conversion', ''].map((h, i) => (
                <th
                  key={h || `col-${i}`}
                  style={{
                    padding: '9px 14px',
                    textAlign: ['Referrals', 'Admissions', 'Conversion'].includes(h) ? 'center' : h === '' ? 'right' : 'left',
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: hexToRgba(palette.backgroundDark.hex, 0.4),
                    width: h === '' ? 56 : undefined,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!hydrated ? (
              Array.from({ length: 6 }).map((_, i) => <SkeletonTableRow key={i} columns={8} />)
            ) : enriched.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '40px 0', textAlign: 'center', fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                  {search.trim() || typeFilter !== 'all'
                    ? 'No sources match your filters.'
                    : 'No referral sources yet. Add the first person who refers to get started.'}
                </td>
              </tr>
            ) : (
              enriched.map((src) => (
                <SourceRow
                  key={src._id}
                  source={src}
                  resolveMarketer={resolveMarketer}
                  onOpen={() => openReferralSource(src)}
                  onEdit={() => setModal({ mode: 'edit', source: src })}
                  canEdit={can(PERMISSION_KEYS.DIRECTORY_EDIT)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <SourceFormModal
          initial={modal.mode === 'edit' ? modal.source : null}
          marketers={marketers}
          onSave={(fields) => (modal.mode === 'edit' ? handleUpdate(modal.source, fields) : handleCreate(fields))}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}

function chipStyle(active) {
  return {
    padding: '5px 11px',
    borderRadius: 16,
    border: active ? `1px solid ${palette.primaryDeepPlum.hex}` : `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.1)}`,
    background: active ? palette.primaryDeepPlum.hex : 'transparent',
    color: active ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.55),
    fontSize: 11.5,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.12s',
  };
}

function SourceRow({ source: src, resolveMarketer, onOpen, onEdit, canEdit }) {
  const [hov, setHov] = useState(false);
  const marketerName = resolveMarketer(src.marketer_id);
  const isUnassigned = !src.marketer_id;
  return (
    <tr
      onClick={onOpen}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      title="Click to view source profile"
      style={{
        borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`,
        background: hov ? hexToRgba(palette.primaryDeepPlum.hex, 0.03) : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.12s',
      }}
    >
      <td style={{ padding: '11px 14px' }}>
        <p style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex }}>
          {src.name || <em style={{ color: hexToRgba(palette.backgroundDark.hex, 0.4), fontWeight: 400 }}>Unnamed</em>}
        </p>
        {src.id && (
          <p style={{ fontSize: 10.5, color: hexToRgba(palette.backgroundDark.hex, 0.32), marginTop: 1, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            {src.id}
          </p>
        )}
      </td>
      <td style={{ padding: '11px 14px' }}>
        <TypeBadge type={src.type} />
      </td>
      <td style={{ padding: '11px 14px', fontSize: 12.5, color: src.source_entity ? hexToRgba(palette.backgroundDark.hex, 0.7) : hexToRgba(palette.backgroundDark.hex, 0.3), fontStyle: src.source_entity ? 'normal' : 'italic' }}>
        {src.source_entity || '—'}
      </td>
      <td style={{ padding: '11px 14px', fontSize: 12.5, color: isUnassigned ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.6), fontWeight: isUnassigned ? 600 : 400, fontStyle: isUnassigned ? 'italic' : 'normal' }}>
        {isUnassigned ? 'Unassigned' : marketerName}
      </td>
      <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: src.refCount > 0 ? 650 : 400, color: src.refCount > 0 ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.3), textAlign: 'center' }}>
        {src.refCount}
      </td>
      <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: src.admitted > 0 ? 650 : 400, color: src.admitted > 0 ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.3), textAlign: 'center' }}>
        {src.admitted}
      </td>
      <td style={{ padding: '11px 14px', textAlign: 'center' }}>
        {src.refCount > 0 ? (
          <span style={{ fontSize: 13, fontWeight: 650, color: src.convRate >= 50 ? palette.accentGreen.hex : src.convRate >= 25 ? palette.accentOrange.hex : hexToRgba(palette.backgroundDark.hex, 0.45) }}>
            {src.convRate}%
          </span>
        ) : (
          <span style={{ color: hexToRgba(palette.backgroundDark.hex, 0.25) }}>—</span>
        )}
      </td>
      <td style={{ padding: '11px 10px', textAlign: 'right', width: 56 }}>
        {/* Reserved column. The edit button is always rendered so the row
            doesn't shift on hover — opacity is animated instead. */}
        <button
          onClick={(e) => { e.stopPropagation(); if (canEdit) onEdit(); }}
          disabled={!canEdit}
          aria-label={canEdit ? 'Edit source' : 'You do not have permission to edit'}
          title={canEdit ? 'Edit source' : 'No edit permission'}
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: hov ? hexToRgba(palette.primaryDeepPlum.hex, 0.08) : 'transparent',
            border: 'none',
            color: hexToRgba(palette.backgroundDark.hex, 0.55),
            cursor: canEdit ? 'pointer' : 'not-allowed',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: canEdit ? (hov ? 1 : 0) : (hov ? 0.35 : 0),
            transition: 'opacity 0.15s, background 0.12s',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </td>
    </tr>
  );
}
