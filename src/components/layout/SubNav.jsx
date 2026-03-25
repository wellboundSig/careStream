import { useState, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import palette, { hexToRgba } from '../../utils/colors.js';

export const PIN_GROUPS = [
  {
    label: 'Main',
    items: [
      { label: 'Dashboard',  path: '/' },
      { label: 'Pipeline',   path: '/pipeline' },
      { label: 'Patients',   path: '/patients' },
      { label: 'Tasks',      path: '/tasks' },
      { label: 'Reports',    path: '/reports' },
    ],
  },
  {
    label: 'Directory',
    items: [
      { label: 'Marketers',        path: '/directory/marketers' },
      { label: 'Facilities',       path: '/directory/facilities' },
      { label: 'Physicians',       path: '/directory/physicians' },
      { label: 'Campaigns',        path: '/directory/campaigns' },
      { label: 'Referral Sources', path: '/directory/referral-sources' },
    ],
  },
  {
    label: 'Modules',
    items: [
      { label: 'Leads',          path: '/modules/lead-entry' },
      { label: 'Intake',         path: '/modules/intake' },
      { label: 'Eligibility',    path: '/modules/eligibility' },
      { label: 'Disenrollment',  path: '/modules/disenrollment' },
      { label: 'F2F / MD Orders',path: '/modules/f2f' },
      { label: 'Clinical Intake',path: '/modules/clinical-rn' },
      { label: 'Auth Pending',   path: '/modules/authorization' },
      { label: 'Conflict',       path: '/modules/conflict' },
      { label: 'Staffing',       path: '/modules/staffing' },
      { label: 'Admin Confirm',  path: '/modules/admin-confirmation' },
      { label: 'Pre-SOC',        path: '/modules/pre-soc' },
      { label: 'Completed',      path: '/modules/soc-completed' },
      { label: 'Hold',           path: '/modules/hold' },
      { label: 'NTUC',           path: '/modules/ntuc' },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'Team',       path: '/team' },
      { label: 'Data Tools', path: '/admin/data-tools' },
      { label: 'Settings',   path: '/admin/settings' },
    ],
  },
];

export const ALL_PINNABLE = PIN_GROUPS.flatMap((g) => g.items);

function isPathActive(path, pathname) {
  if (path === '/') return pathname === '/';
  return pathname === path || pathname.startsWith(path + '/');
}

export default function SubNav({ pinnedPages, onReorder }) {
  const location = useLocation();
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const dragRef = useRef(null);

  if (!pinnedPages || pinnedPages.length === 0) return null;

  const tabs = pinnedPages
    .map((path) => ALL_PINNABLE.find((p) => p.path === path))
    .filter(Boolean);

  function handleDragStart(e, idx) {
    setDragIdx(idx);
    dragRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', idx.toString());
  }

  function handleDragOver(e, idx) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (idx !== overIdx) setOverIdx(idx);
  }

  function handleDrop(e, dropIdx) {
    e.preventDefault();
    const fromIdx = dragRef.current;
    if (fromIdx === null || fromIdx === dropIdx) { resetDrag(); return; }
    const newOrder = [...pinnedPages];
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(dropIdx, 0, moved);
    onReorder?.(newOrder);
    resetDrag();
  }

  function resetDrag() {
    setDragIdx(null);
    setOverIdx(null);
    dragRef.current = null;
  }

  return (
    <nav
      aria-label="Pinned pages"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        height: 36,
        background: palette.backgroundLight.hex,
        borderBottom: `1px solid var(--color-border)`,
        padding: '0 20px',
        gap: 2,
        flexShrink: 0,
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {tabs.map(({ label, path }, idx) => {
        const active = isPathActive(path, location.pathname);
        const isDragging = dragIdx === idx;
        const isOver = overIdx === idx && dragIdx !== idx;
        return (
          <Link
            key={path}
            to={path}
            draggable
            onDragStart={(e) => handleDragStart(e, idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={(e) => handleDrop(e, idx)}
            onDragEnd={resetDrag}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '0 14px',
              fontSize: 12.5,
              fontWeight: active ? 620 : 440,
              color: active
                ? palette.primaryMagenta.hex
                : hexToRgba(palette.backgroundDark.hex, 0.52),
              borderBottom: active
                ? `2px solid ${palette.primaryMagenta.hex}`
                : '2px solid transparent',
              borderLeft: isOver ? `2px solid ${palette.accentBlue.hex}` : '2px solid transparent',
              marginBottom: -1,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              transition: 'color 0.1s, border-color 0.1s',
              flexShrink: 0,
              opacity: isDragging ? 0.4 : 1,
              cursor: 'grab',
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.color = hexToRgba(palette.backgroundDark.hex, 0.75);
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.color = hexToRgba(palette.backgroundDark.hex, 0.52);
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
