import { useState, useEffect, useMemo } from 'react';
import { getCampaigns, getCampaignMarketers } from '../../api/campaigns.js';
import { getReferrals } from '../../api/referrals.js';
import { useLookups } from '../../hooks/useLookups.js';
import { REGION_COLORS } from './Facilities.jsx';
import LoadingState from '../../components/common/LoadingState.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const STATUS_COLORS = {
  Active:    { bg: hexToRgba(palette.accentGreen.hex, 0.14),      text: palette.accentGreen.hex },
  Paused:    { bg: hexToRgba(palette.highlightYellow.hex, 0.2),   text: '#7A5F00' },
  Completed: { bg: hexToRgba(palette.backgroundDark.hex, 0.08),   text: hexToRgba(palette.backgroundDark.hex, 0.5) },
};

function fmtDate(d) { if (!d) return null; return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

export default function Campaigns() {
  const { resolveMarketer } = useLookups();
  const [campaigns, setCampaigns] = useState([]);
  const [refCounts, setRefCounts] = useState({});
  const [marketersByCamp, setMarketersByCamp] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getCampaigns(), getReferrals({ fields: ['campaign_id', 'current_stage'] })]).then(async ([camps, refs]) => {
      const campList = camps.map((r) => ({ _id: r.id, ...r.fields }));
      setCampaigns(campList);
      const rc = {}; refs.forEach((r) => { const cid = r.fields.campaign_id; if (cid) rc[cid] = (rc[cid] || 0) + 1; }); setRefCounts(rc);
      const mmap = {};
      await Promise.all(campList.map(async (c) => {
        const links = await getCampaignMarketers(c.id).catch(() => []);
        mmap[c.id] = links.map((r) => r.fields.marketer_id).filter(Boolean);
      }));
      setMarketersByCamp(mmap);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return campaigns;
    const q = search.toLowerCase();
    return campaigns.filter((c) => (c.name || '').toLowerCase().includes(q) || (c.region || '').toLowerCase().includes(q));
  }, [campaigns, search]);

  if (loading) return <LoadingState message="Loading campaigns…" />;

  return (
    <>
      <div style={{ padding: '24px 28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: palette.backgroundDark.hex, marginBottom: 3 }}>Campaigns</h1>
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>{filtered.length} campaigns</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: hexToRgba(palette.backgroundDark.hex, 0.04), border: `1px solid var(--color-border)`, borderRadius: 8, padding: '0 12px', height: 34, width: 220 }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search campaigns…" style={{ background: 'none', border: 'none', outline: 'none', fontSize: 13, color: palette.backgroundDark.hex, width: '100%' }} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((camp) => {
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
