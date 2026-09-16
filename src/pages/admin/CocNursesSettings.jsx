import { useMemo, useState } from 'react';
import { useCareStore } from '../../store/careStore.js';
import { useLookups } from '../../hooks/useLookups.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import { listCocNurseRoster } from '../../utils/cocNurseRoster.js';
import AccessDenied from '../../components/common/AccessDenied.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const muted = (a = 0.42) => hexToRgba(palette.backgroundDark.hex, a);

export default function CocNursesSettings() {
  const { can } = usePermissions();
  const { resolveFacility } = useLookups();
  const users = useCareStore((s) => s.users);
  const roles = useCareStore((s) => s.roles);
  const cocNurseFacilities = useCareStore((s) => s.cocNurseFacilities);
  const [search, setSearch] = useState('');

  const roster = useMemo(
    () => listCocNurseRoster({ users, roles, cocNurseFacilities, resolveFacility }),
    [users, roles, cocNurseFacilities, resolveFacility],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter((row) => {
      if (row.name.toLowerCase().includes(q)) return true;
      if (row.email.toLowerCase().includes(q)) return true;
      return row.facilities.some((f) => f.name.toLowerCase().includes(q));
    });
  }, [roster, search]);

  if (!can(PERMISSION_KEYS.ADMIN_SETTINGS)) {
    return <AccessDenied message="You need Global Configuration permission to open the COC roster." />;
  }

  const unassigned = roster.filter((r) => !r.assigned).length;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 960 }}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: palette.backgroundDark.hex, margin: '0 0 4px' }}>
        COC nurses
      </h2>
      <p style={{ fontSize: 13, color: muted(), margin: '0 0 16px', lineHeight: 1.45 }}>
        Continuity of Care nurses and the facilities they are assigned to. Assignments are edited on each user&apos;s profile (COC Facilities).
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search nurse or facility…"
          aria-label="Search COC nurses"
          style={{
            flex: 1, minWidth: 220, padding: '8px 12px', borderRadius: 8,
            border: '1px solid var(--color-border)', fontSize: 13, fontFamily: 'inherit',
            color: palette.backgroundDark.hex, background: hexToRgba(palette.backgroundDark.hex, 0.03),
            outline: 'none',
          }}
        />
        <p style={{ fontSize: 12.5, color: muted(0.5), margin: 0, whiteSpace: 'nowrap' }}>
          {roster.length} nurse{roster.length === 1 ? '' : 's'}
          {unassigned > 0 ? ` · ${unassigned} unassigned` : ''}
        </p>
      </div>

      {visible.length === 0 ? (
        <p style={{ fontSize: 13, color: muted(), fontStyle: 'italic', margin: 0 }}>
          {roster.length === 0 ? 'No COC nurses found.' : 'No nurses match that search.'}
        </p>
      ) : (
        <div
          style={{
            background: palette.backgroundLight.hex,
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <table data-testid="coc-nurse-roster" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                {['Nurse', 'Status', 'Assigned', 'Facilities'].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: 'left', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em',
                      textTransform: 'uppercase', color: muted(0.4), padding: '10px 16px',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.userId} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
                    <p style={{ fontSize: 13.5, fontWeight: 650, color: palette.backgroundDark.hex, margin: 0 }}>
                      {row.name}
                    </p>
                    {row.email ? (
                      <p style={{ fontSize: 12, color: muted(0.45), margin: '2px 0 0' }}>{row.email}</p>
                    ) : null}
                  </td>
                  <td style={{ padding: '12px 16px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                    <StatusChip status={row.status} />
                  </td>
                  <td style={{ padding: '12px 16px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                    <span style={{
                      fontSize: 12.5, fontWeight: 650,
                      color: row.assigned ? palette.accentGreen.hex : palette.primaryMagenta.hex,
                    }}>
                      {row.assigned ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', verticalAlign: 'top' }}>
                    {row.facilities.length === 0 ? (
                      <span style={{ fontSize: 13, color: muted(0.35), fontStyle: 'italic' }}>None</span>
                    ) : (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                        {row.facilities.map((f) => (
                          <li key={f.id} style={{ fontSize: 13, color: palette.backgroundDark.hex, lineHeight: 1.45 }}>
                            {f.name}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }) {
  const active = status === 'Active';
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 4,
      color: active ? palette.accentGreen.hex : muted(0.5),
      background: active ? hexToRgba(palette.accentGreen.hex, 0.12) : hexToRgba(palette.backgroundDark.hex, 0.06),
    }}>
      {status}
    </span>
  );
}
