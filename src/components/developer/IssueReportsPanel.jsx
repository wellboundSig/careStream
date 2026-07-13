import { useEffect, useMemo, useState } from 'react';
import { useCareStore } from '../../store/careStore.js';
import { getSignedFileUrl, openSignedFile } from '../../utils/r2Upload.js';
import palette, { hexToRgba } from '../../utils/colors.js';

const TYPE_LABELS = {
  bug: 'Bug / Mistake',
  enhancement: 'Suggested Enhancement',
};

const TYPE_COLORS = {
  bug: { bg: hexToRgba(palette.primaryMagenta.hex, 0.12), text: palette.primaryMagenta.hex },
  enhancement: { bg: hexToRgba(palette.accentBlue.hex, 0.12), text: palette.accentBlue.hex },
};

function formatWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function userLabel(users, userId) {
  const u = Object.values(users || {}).find((x) => x.id === userId);
  if (!u) return userId || 'Unknown';
  const name = `${u.first_name || ''} ${u.last_name || ''}`.trim();
  return name || u.email || userId;
}

/**
 * Support-staff view of IssueReports — used inside Developer Tools.
 */
export default function IssueReportsPanel() {
  const storeReports = useCareStore((s) => s.issueReports);
  const storeUsers = useCareStore((s) => s.users);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  const [signedUrl, setSignedUrl] = useState('');

  const reports = useMemo(() => {
    let list = Object.values(storeReports || {});
    if (filter !== 'all') list = list.filter((r) => r.report_type === filter);
    return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }, [storeReports, filter]);

  useEffect(() => {
    let cancelled = false;
    setSignedUrl('');
    if (!selected?.screenshot_r2_key) return undefined;
    getSignedFileUrl({ r2_key: selected.screenshot_r2_key })
      .then((url) => { if (!cancelled) setSignedUrl(url || ''); })
      .catch(() => { if (!cancelled) setSignedUrl(''); });
    return () => { cancelled = true; };
  }, [selected?._id, selected?.screenshot_r2_key]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, padding: '14px 18px', borderBottom: `1px solid var(--color-border)`, flexShrink: 0,
      }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>
            Issue reports
          </p>
          <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), margin: '3px 0 0' }}>
            {reports.length} report{reports.length === 1 ? '' : 's'}
            {filter !== 'all' ? ` · filtered` : ''}
          </p>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            padding: '7px 10px', borderRadius: 8, border: `1px solid var(--color-border)`,
            fontSize: 12.5, fontFamily: 'inherit', background: palette.backgroundLight.hex,
          }}
        >
          <option value="all">All types</option>
          <option value="bug">Bugs / Mistakes</option>
          <option value="enhancement">Enhancements</option>
        </select>
      </div>

      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {reports.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: hexToRgba(palette.backgroundDark.hex, 0.4), fontSize: 13.5 }}>
            No issue reports yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: hexToRgba(palette.backgroundDark.hex, 0.03), borderBottom: `1px solid var(--color-border)` }}>
                {['Reported', 'By', 'Type', ''].map((h) => (
                  <th key={h || 'a'} style={{
                    padding: '9px 14px', textAlign: 'left', fontSize: 10.5, fontWeight: 700,
                    letterSpacing: '0.05em', textTransform: 'uppercase',
                    color: hexToRgba(palette.backgroundDark.hex, 0.4),
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const colors = TYPE_COLORS[r.report_type] || TYPE_COLORS.bug;
                return (
                  <tr
                    key={r._id || r.id}
                    style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}
                  >
                    <td style={{ padding: '11px 14px', fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.65), whiteSpace: 'nowrap' }}>
                      {formatWhen(r.created_at)}
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: 13, fontWeight: 550, color: palette.backgroundDark.hex }}>
                      {userLabel(storeUsers, r.user_id)}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{
                        fontSize: 11.5, fontWeight: 650, padding: '3px 9px', borderRadius: 6,
                        background: colors.bg, color: colors.text,
                      }}>
                        {TYPE_LABELS[r.report_type] || r.report_type}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => setSelected(r)}
                        style={{
                          padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                          background: hexToRgba(palette.primaryDeepPlum.hex, 0.08),
                          color: palette.primaryDeepPlum.hex, fontSize: 12, fontWeight: 650,
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9990,
            background: hexToRgba(palette.backgroundDark.hex, 0.45),
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: palette.backgroundLight.hex, borderRadius: 14, width: '100%', maxWidth: 560,
              maxHeight: '85vh', overflow: 'auto',
              boxShadow: `0 12px 40px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`,
            }}
          >
            <div style={{
              padding: '16px 20px', borderBottom: `1px solid var(--color-border)`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12,
            }}>
              <div>
                <span style={{
                  fontSize: 11.5, fontWeight: 650, padding: '3px 9px', borderRadius: 6,
                  background: (TYPE_COLORS[selected.report_type] || TYPE_COLORS.bug).bg,
                  color: (TYPE_COLORS[selected.report_type] || TYPE_COLORS.bug).text,
                }}>
                  {TYPE_LABELS[selected.report_type] || selected.report_type}
                </span>
                <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5), margin: '8px 0 0' }}>
                  {userLabel(storeUsers, selected.user_id)} · {formatWhen(selected.created_at)}
                </p>
              </div>
                <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close"
                style={{
                  width: 28, height: 28, borderRadius: 7, border: 'none', cursor: 'pointer',
                  background: hexToRgba(palette.backgroundDark.hex, 0.06),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1l10 10M11 1L1 11" stroke={hexToRgba(palette.backgroundDark.hex, 0.55)} strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div style={{ padding: '18px 20px' }}>
              <p style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 8,
              }}>
                Description
              </p>
              <p style={{
                fontSize: 14, color: palette.backgroundDark.hex, lineHeight: 1.55,
                whiteSpace: 'pre-wrap', margin: 0,
              }}>
                {selected.description || '—'}
              </p>

              {selected.screenshot_r2_key && (
                <div style={{ marginTop: 20 }}>
                  <p style={{
                    fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase',
                    color: hexToRgba(palette.backgroundDark.hex, 0.4), marginBottom: 8,
                  }}>
                    Screenshot
                  </p>
                  {signedUrl ? (
                    <button
                      type="button"
                      onClick={() => openSignedFile({ r2_key: selected.screenshot_r2_key })}
                      style={{ display: 'block', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                    >
                      <img
                        src={signedUrl}
                        alt={selected.screenshot_file_name || 'Screenshot'}
                        style={{
                          maxWidth: '100%', maxHeight: 320, borderRadius: 8,
                          border: `1px solid var(--color-border)`, display: 'block',
                        }}
                      />
                    </button>
                  ) : (
                    <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
                      Loading attachment…
                    </p>
                  )}
                  {selected.screenshot_file_name && (
                    <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.4), marginTop: 6 }}>
                      {selected.screenshot_file_name}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
