import { useState, useMemo } from 'react';
import { useCareStore, mergeEntities } from '../../store/careStore.js';
import { useLookups } from '../../hooks/useLookups.js';
import { REGION_COLORS } from './Facilities.jsx';
import { SkeletonRect } from '../../components/common/Skeleton.jsx';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import { createCampaign } from '../../api/campaigns.js';
import AccessDenied from '../../components/common/AccessDenied.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const STATUS_COLORS = {
  Active:    { bg: hexToRgba(palette.accentGreen.hex, 0.14),      text: palette.accentGreen.hex },
  Paused:    { bg: hexToRgba(palette.highlightYellow.hex, 0.2),   text: '#7A5F00' },
  Completed: { bg: hexToRgba(palette.backgroundDark.hex, 0.08),   text: hexToRgba(palette.backgroundDark.hex, 0.5) },
};

function fmtDate(d) { if (!d) return null; return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

export default function Campaigns() {
  const { resolveMarketer } = useLookups();
  const storeCampaigns = useCareStore((s) => s.campaigns);
  const storeCM = useCareStore((s) => s.campaignMarketers);
  const storeRefs = useCareStore((s) => s.referrals);
  const hydrated = useCareStore((s) => s.hydrated);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const campaigns = useMemo(() => Object.values(storeCampaigns), [storeCampaigns]);

  const refCounts = useMemo(() => {
    const rc = {};
    Object.values(storeRefs).forEach((r) => {
      const cid = r.campaign_id;
      if (cid) rc[cid] = (rc[cid] || 0) + 1;
    });
    return rc;
  }, [storeRefs]);

  const marketersByCamp = useMemo(() => {
    const mmap = {};
    Object.values(storeCM).forEach((link) => {
      const cid = link.campaign_id;
      const mid = link.marketer_id;
      if (cid && mid) {
        if (!mmap[cid]) mmap[cid] = [];
        mmap[cid].push(mid);
      }
    });
    return mmap;
  }, [storeCM]);

  const filtered = useMemo(() => {
    if (!search.trim()) return campaigns;
    const q = search.toLowerCase();
    return campaigns.filter((c) => (c.name || '').toLowerCase().includes(q) || (c.region || '').toLowerCase().includes(q));
  }, [campaigns, search]);

  const [showNewCampaign, setShowNewCampaign] = useState(false);

  const { can } = usePermissions();
  if (!can(PERMISSION_KEYS.DIRECTORY_VIEW)) return <AccessDenied message="You do not have permission to view the directory." />;

  return (
    <>
      <div style={{ padding: '24px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Campaigns</h1>
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{filtered.length} campaigns</p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 8, padding: '0 12px', height: 34, width: 220 }}>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search campaigns…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
            </div>
            {can(PERMISSION_KEYS.DIRECTORY_CREATE) && (
              <button onClick={() => setShowNewCampaign(true)} style={{ height: 34, padding: '0 16px', borderRadius: 8, background: palette.accentGreen.hex, border: 'none', fontSize: 13, fontWeight: 650, color: palette.backgroundLight.hex, cursor: 'pointer' }}>
                + Add Campaign
              </button>
            )}
          </div>
        </div>

        {showNewCampaign && (
          <NewCampaignForm onClose={() => setShowNewCampaign(false)} onCreated={() => setShowNewCampaign(false)} />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {!hydrated ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonRect key={i} height={90} />)
          ) : filtered.map((camp) => {
            const sc = STATUS_COLORS[camp.status] || STATUS_COLORS.Active;
            const rc = REGION_COLORS[camp.region];
            const mktIds = marketersByCamp[camp.id] || [];
            const count = refCounts[camp.id] || 0;
            return (
              <div key={camp._id} onDoubleClick={() => setSelected(camp === selected ? null : camp)}
                title="Double-click to expand"
                style={{ padding: '16px 18px', borderRadius: 12, background: palette.backgroundLight.hex, border: `1px solid var(--color-border)`, cursor: 'default', transition: 'box-shadow 0.15s', boxShadow: selected?._id === camp._id ? `0 0 0 2px ${palette.primaryMagenta.hex}` : 'none' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                      <p style={{ fontSize: 14, fontWeight: 700, color: palette.backgroundDark.hex }}>{camp.name}</p>
                      <span style={{ fontSize: 11.5, fontWeight: 650, padding: '2px 9px', borderRadius: 20, background: sc.bg, color: sc.text }}>{camp.status}</span>
                      {camp.division && <span style={{ fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: camp.division === 'Special Needs' ? hexToRgba(palette.primaryMagenta.hex, 0.12) : hexToRgba(palette.highlightYellow.hex, 0.2), color: camp.division === 'Special Needs' ? palette.primaryMagenta.hex : '#7A5F00' }}>{camp.division}</span>}
                      {rc && <span style={{ fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 20, background: rc.bg, color: rc.text }}>{camp.region}</span>}
                    </div>
                    <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
                      {[fmtDate(camp.start_date), fmtDate(camp.end_date)].filter(Boolean).join(' → ')}
                    </p>
                    {mktIds.length > 0 && (
                      <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginTop: 4 }}>
                        Marketers: {mktIds.map((id) => resolveMarketer(id)).join(', ')}
                      </p>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 28, fontWeight: 800, color: count > 0 ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.25), lineHeight: 1 }}>{count}</p>
                    <p style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>referrals</p>
                  </div>
                </div>
                {camp.notes && <p style={{ marginTop: 10, fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.5, fontStyle: 'italic' }}>{camp.notes}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

const DIVISIONS_LIST = ['ALF', 'Special Needs', 'Both'];
const STATUS_LIST = ['Active', 'Paused', 'Completed'];

function NewCampaignForm({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [division, setDivision] = useState('');
  const [status, setStatus] = useState('Active');
  const [region, setRegion] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = name.trim() && !saving;

  async function handleSave() {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      const fields = {
        id: `camp_${Date.now()}`,
        name: name.trim(),
        status,
        created_at: new Date().toISOString(),
        ...(division && { division }),
        ...(region && { region }),
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
        ...(notes.trim() && { notes: notes.trim() }),
      };
      const rec = await createCampaign(fields);
      mergeEntities('campaigns', { [rec.id]: { _id: rec.id, ...rec.fields } });
      onCreated();
    } catch (err) {
      setError(err.message || 'Failed to create campaign');
      setSaving(false);
    }
  }

  const inp = { width: '100%', padding: '8px 11px', borderRadius: 7, border: '1px solid var(--color-border)', fontSize: 13, fontFamily: 'inherit', outline: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.03), color: palette.backgroundDark.hex, boxSizing: 'border-box' };

  return (
    <div style={{ padding: '18px 20px', borderRadius: 12, border: `1px solid ${hexToRgba(palette.accentGreen.hex, 0.3)}`, background: hexToRgba(palette.accentGreen.hex, 0.04), marginBottom: 18 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: palette.accentGreen.hex, marginBottom: 12, letterSpacing: '0.03em', textTransform: 'uppercase' }}>New Campaign</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', marginBottom: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" style={inp} autoFocus />
        </div>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Division</label>
          <select value={division} onChange={(e) => setDivision(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
            <option value="">— select —</option>
            {DIVISIONS_LIST.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...inp, cursor: 'pointer' }}>
            {STATUS_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Region</label>
          <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. Brooklyn, Bronx" style={inp} />
        </div>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Start Date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inp} />
        </div>
        <div>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>End Date</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inp} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={{ fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 4 }}>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional campaign notes…" rows={2} style={{ ...inp, resize: 'vertical' }} />
        </div>
      </div>
      {error && <p style={{ fontSize: 12, color: palette.primaryMagenta.hex, marginBottom: 8 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={{ padding: '7px 18px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'none', fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer' }}>Cancel</button>
        <button onClick={handleSave} disabled={!canSubmit} style={{ padding: '7px 22px', borderRadius: 7, border: 'none', background: canSubmit ? palette.accentGreen.hex : hexToRgba(palette.backgroundDark.hex, 0.07), fontSize: 13, fontWeight: 650, color: canSubmit ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3), cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
          {saving ? 'Creating…' : 'Create Campaign'}
        </button>
      </div>
    </div>
  );
}
