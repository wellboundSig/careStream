import { useEffect, useMemo, useRef, useState } from 'react';
import { getReferrals } from '../../api/referrals.js';
import { createUserPermission, updateUserPermission } from '../../api/userPermissions.js';
import { syncUserLanguages } from '../../api/userLanguages.js';
import { syncCocNurseFacilities } from '../../api/cocNurseFacilities.js';
import airtable from '../../api/airtable.js';
import { useCareStore, mergeEntities, removeEntity, updateEntity } from '../../store/careStore.js';
import { useLookups } from '../../hooks/useLookups.js';
import { useCurrentAppUser } from '../../hooks/useCurrentAppUser.js';
import {
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
} from '../../data/permissionKeys.js';
import { LANGUAGES, languageById } from '../../data/languages.js';
import RoleChangeDialog from './RoleChangeDialog.jsx';
import PermissionChecklist from './PermissionChecklist.jsx';
import StageBadge from '../common/StageBadge.jsx';
import DivisionBadge from '../common/DivisionBadge.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const STATUSES = ['Active', 'Pending', 'Suspended', 'Revoked'];
const ALL_PERM_KEYS = Object.values(PERMISSION_KEYS);

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'access', label: 'Access' },
  { id: 'languages', label: 'Languages' },
  { id: 'coc', label: 'COC Facilities' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'assignment', label: 'Assignment' },
];

const STATUS_COLORS = {
  Active:    { bg: hexToRgba(palette.accentGreen.hex, 0.18), text: palette.accentGreen.hex },
  Pending:   { bg: hexToRgba(palette.highlightYellow.hex, 0.25), text: '#7A5F00' },
  Suspended: { bg: hexToRgba(palette.accentOrange.hex, 0.2), text: palette.accentOrange.hex },
  Revoked:   { bg: hexToRgba(palette.backgroundDark.hex, 0.1), text: hexToRgba(palette.backgroundDark.hex, 0.45) },
};

function initials(first, last) {
  return `${(first || '?')[0]}${(last || '')[0] || ''}`.toUpperCase();
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function displayName(u) {
  return `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email || u.id;
}

function firstId(v) {
  if (Array.isArray(v)) return v[0] || null;
  return v || null;
}

// Cache assigned-referrals per user so re-opening the sheet renders instantly;
// a background refetch still refreshes the data.
const referralsCache = new Map();

/**
 * Single user settings sheet — Linear/Slack-style member settings.
 * Sections keep existing behavior (role/status/permissions/assignees) without
 * stacking separate modals.
 */
export default function UserSettingsSheet({
  user,
  roles,
  canEditPerms,
  onClose,
  onToast,
  onStatusChange,
  onRoleApplied,
}) {
  const { appUserId } = useCurrentAppUser();
  const { resolveRole, resolvePatient } = useLookups();
  const storeUsers = useCareStore((s) => s.users);
  const storeRoles = useCareStore((s) => s.roles);
  const storeDepartments = useCareStore((s) => s.departments);
  const storeUserPerms = useCareStore((s) => s.userPermissions);
  const storeUserLanguages = useCareStore((s) => s.userLanguages);
  const storePresets = useCareStore((s) => s.permissionPresets);
  const storeLanguages = useCareStore((s) => s.languages);
  const storeCocNurseFacs = useCareStore((s) => s.cocNurseFacilities);
  const storeNetFacs = useCareStore((s) => s.networkFacilities);

  const [section, setSection] = useState('overview');
  const [roleChange, setRoleChange] = useState(null);
  const [savingRole, setSavingRole] = useState(false);
  const [animated, setAnimated] = useState(false);

  const [referrals, setReferrals] = useState(() => referralsCache.get(user?.id) || []);
  const [loadingRefs, setLoadingRefs] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    setSection('overview');
    const t = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(t);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const cached = referralsCache.get(user.id);
    if (cached) {
      setReferrals(cached);
    } else {
      setReferrals([]);
      setLoadingRefs(true);
    }
    getReferrals({ filterByFormula: `{intake_owner_id} = "${user.id}"` })
      .then((recs) => {
        const rows = recs.map((r) => ({ _id: r.id, ...r.fields }));
        referralsCache.set(user.id, rows);
        setReferrals(rows);
      })
      .catch(() => {})
      .finally(() => setLoadingRefs(false));
  }, [user?.id]);

  // Slide out before unmounting so closing feels as smooth as opening.
  const closingRef = useRef(false);
  function handleClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    setAnimated(false);
    setTimeout(() => { closingRef.current = false; onClose(); }, 280);
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !roleChange) handleClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [roleChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const languageCatalog = useMemo(() => {
    const fromStore = Object.values(storeLanguages || {})
      .filter((l) => l.is_active !== false)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    return fromStore.length ? fromStore : LANGUAGES;
  }, [storeLanguages]);

  const userLangRecords = useMemo(
    () => Object.values(storeUserLanguages || {}).filter((r) => r.user_id === user?.id),
    [storeUserLanguages, user?.id],
  );

  const userCocRecords = useMemo(
    () => Object.values(storeCocNurseFacs || {}).filter((r) => r.user_id === user?.id),
    [storeCocNurseFacs, user?.id],
  );

  const networkFacilityList = useMemo(
    () => Object.values(storeNetFacs || {})
      .filter((f) => f.id && f.name)
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [storeNetFacs],
  );

  const existingPerm = useMemo(() => {
    if (!user?.id) return null;
    return Object.values(storeUserPerms).find((up) => up.user_id === user.id) || null;
  }, [user?.id, storeUserPerms]);

  if (!user) return null;

  const roleName = resolveRole(user.role_id);
  const statusStyle = STATUS_COLORS[user.status] || STATUS_COLORS.Active;
  const activeCases = referrals.filter((r) => r.current_stage !== 'SOC Completed' && r.current_stage !== 'NTUC');
  const completed = referrals.filter((r) => r.current_stage === 'SOC Completed');
  const ntuc = referrals.filter((r) => r.current_stage === 'NTUC');

  async function confirmRoleChange(choice) {
    if (!roleChange) return;
    const { newRoleId } = roleChange;
    setSavingRole(true);
    updateEntity('users', user._id, { role_id: newRoleId });
    try {
      await airtable.update('Users', user._id, { role_id: newRoleId });
      if (choice === 'apply') {
        const role = Object.values(storeRoles).find((r) => r.id === newRoleId);
        const presetId = firstId(role?.default_preset_id);
        const preset = presetId ? Object.values(storePresets).find((p) => p.id === presetId) : null;
        if (preset?.permissions) {
          const now = new Date().toISOString();
          const existingRec = Object.values(storeUserPerms).find((up) => up.user_id === user.id);
          if (existingRec?._id) {
            const fields = { permissions: preset.permissions, last_preset_id: preset.id, updated_at: now, updated_by: appUserId || '' };
            await updateUserPermission(existingRec._id, fields);
            mergeEntities('userPermissions', { [existingRec._id]: { ...existingRec, ...fields } });
          } else {
            const fields = { id: `up_${user.id}`, user_id: user.id, permissions: preset.permissions, last_preset_id: preset.id, updated_at: now, updated_by: appUserId || '' };
            const rec = await createUserPermission(fields);
            mergeEntities('userPermissions', { [rec.id]: { _id: rec.id, ...rec.fields } });
          }
          onToast?.(`Role updated → applied “${preset.name}”`);
        } else {
          onToast?.('Role updated (no default preset linked)');
        }
      } else {
        onToast?.('Role updated — permissions unchanged');
      }
      onRoleApplied?.(newRoleId);
      setRoleChange(null);
    } catch (err) {
      onToast?.(`Failed: ${err.message}`, 'error');
    } finally {
      setSavingRole(false);
    }
  }

  return (
    <>
      <div
        onClick={handleClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: hexToRgba(palette.backgroundDark.hex, animated ? 0.35 : 0),
          transition: 'background 0.3s',
          backdropFilter: animated ? 'blur(2px)' : 'none',
        }}
      />
      <div
        role="dialog"
        aria-label={`Settings for ${displayName(user)}`}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(720px, 100vw)', zIndex: 1001,
          background: palette.backgroundLight.hex,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: `-8px 0 32px ${hexToRgba(palette.backgroundDark.hex, 0.15)}`,
          transform: animated ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Header — matches MarketerDrawer / PatientDrawer plum header */}
        <div style={{ background: palette.primaryDeepPlum.hex, padding: '20px 22px 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {user.clerk_image_url ? (
                <img src={user.clerk_image_url} alt={`${user.first_name} ${user.last_name}`} style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{
                  width: 48, height: 48, borderRadius: 13, flexShrink: 0,
                  background: hexToRgba(palette.primaryMagenta.hex, 0.25),
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 17, fontWeight: 800, color: palette.primaryMagenta.hex,
                }}>
                  {initials(user.first_name, user.last_name)}
                </div>
              )}
              <div>
                <p style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundLight.hex, marginBottom: 2 }}>
                  {user.first_name} {user.last_name}
                </p>
                <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundLight.hex, 0.5) }}>{user.email || 'No email'}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              style={{ width: 28, height: 28, borderRadius: 7, background: hexToRgba(palette.backgroundLight.hex, 0.1), border: 'none', color: hexToRgba(palette.backgroundLight.hex, 0.7), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 10px', borderRadius: 20, background: hexToRgba(palette.backgroundLight.hex, 0.14), color: hexToRgba(palette.backgroundLight.hex, 0.85) }}>
              {roleName || 'No role'}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 650, padding: '3px 10px', borderRadius: 20, background: statusStyle.bg, color: statusStyle.text }}>
              {user.status || 'Active'}
            </span>
          </div>
        </div>

        {/* Tab bar — house underline style */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0, scrollbarWidth: 'none', overflowX: 'auto' }}>
          {SECTIONS.map((s) => {
            if ((s.id === 'permissions' || s.id === 'assignment') && !canEditPerms) return null;
            const isActive = section === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                style={{
                  padding: '11px 18px', background: 'none', border: 'none',
                  borderBottom: `2px solid ${isActive ? palette.primaryMagenta.hex : 'transparent'}`,
                  fontSize: 12.5, fontWeight: isActive ? 650 : 450,
                  color: isActive ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.5),
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  transition: 'color 0.15s, border-color 0.15s',
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Body — permissions owns its own scroll so search stays pinned */}
        <div style={{
          flex: 1,
          minHeight: 0,
          overflow: section === 'permissions' ? 'hidden' : 'auto',
          padding: section === 'permissions' ? '16px 24px 16px' : '20px 24px 32px',
          display: section === 'permissions' ? 'flex' : 'block',
          flexDirection: 'column',
        }}>
          {section === 'overview' && (
            <OverviewSection
              user={user}
              loadingRefs={loadingRefs}
              activeCases={activeCases}
              completed={completed}
              ntuc={ntuc}
              resolvePatient={resolvePatient}
              languageNames={userLangRecords.map((r) => languageById(r.language_id)?.name || r.language_id).filter(Boolean)}
              cocFacilityNames={userCocRecords.map((r) => {
                const fac = networkFacilityList.find((f) => f.id === r.facility_id);
                return fac?.name || r.facility_id;
              }).filter(Boolean)}
            />
          )}
          {section === 'access' && (
            <AccessSection
              user={user}
              roles={roles}
              statusStyle={statusStyle}
              onRequestRoleChange={(newRoleId) => {
                if (newRoleId === user.role_id) return;
                setRoleChange({ newRoleId });
              }}
              onStatusChange={(value) => onStatusChange?.(value)}
            />
          )}
          {section === 'languages' && (
            <LanguagesSection
              user={user}
              catalog={languageCatalog}
              existing={userLangRecords}
              onToast={onToast}
            />
          )}
          {section === 'coc' && (
            <CocFacilitiesSection
              user={user}
              facilities={networkFacilityList}
              existing={userCocRecords}
              onToast={onToast}
            />
          )}
          {section === 'permissions' && canEditPerms && (
            <PermissionsSection
              user={user}
              existingRecord={existingPerm}
              presets={Object.values(storePresets)}
              appUserId={appUserId}
              onToast={onToast}
            />
          )}
          {section === 'assignment' && canEditPerms && (
            <AssignmentSection
              user={user}
              existingRecord={existingPerm}
              allUsers={Object.values(storeUsers)}
              departments={Object.values(storeDepartments || {})}
              roles={storeRoles}
              appUserId={appUserId}
              onToast={onToast}
            />
          )}
        </div>
      </div>

      {roleChange && (
        <RoleChangeDialog
          user={user}
          newRoleId={roleChange.newRoleId}
          working={savingRole}
          onCancel={() => setRoleChange(null)}
          onConfirm={confirmRoleChange}
        />
      )}
    </>
  );
}

function SectionTitle({ title, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: palette.backgroundDark.hex, margin: 0 }}>{title}</h3>
      {hint && (
        <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.5), marginTop: 4, lineHeight: 1.45 }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function OverviewSection({ user, loadingRefs, activeCases, completed, ntuc, resolvePatient, languageNames, cocFacilityNames = [] }) {
  return (
    <div>
      <SectionTitle title="Overview" hint="At-a-glance account info. Edit details in the other tabs." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Active cases', value: loadingRefs ? '…' : activeCases.length },
          { label: 'SOC completed', value: loadingRefs ? '…' : completed.length },
          { label: 'NTUC', value: loadingRefs ? '…' : ntuc.length },
          { label: 'Last login', value: timeAgo(user.last_login_at) },
        ].map((stat) => (
          <div key={stat.label} style={{
            padding: '12px 14px', borderRadius: 10,
            border: '1px solid var(--color-border)',
            background: hexToRgba(palette.backgroundDark.hex, 0.02),
          }}>
            <p style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.4), textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {stat.label}
            </p>
            <p style={{ fontSize: 18, fontWeight: 700, color: palette.backgroundDark.hex, marginTop: 4 }}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 18 }}>
        <p style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.4), textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
          Languages spoken
        </p>
        {languageNames.length === 0 ? (
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>None set — add in Languages</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {languageNames.map((n) => (
              <span key={n} style={{
                fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                background: hexToRgba(palette.accentBlue.hex, 0.1), color: palette.accentBlue.hex,
              }}>{n}</span>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 18 }}>
        <p style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.4), textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
          COC facilities
        </p>
        {cocFacilityNames.length === 0 ? (
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>None — assign in COC Facilities</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {cocFacilityNames.map((n) => (
              <span key={n} style={{
                fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20,
                background: hexToRgba(palette.primaryDeepPlum.hex, 0.1), color: palette.primaryDeepPlum.hex,
              }}>{n}</span>
            ))}
          </div>
        )}
      </div>

      <p style={{ fontSize: 11, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.4), textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
        Recent cases
      </p>
      {loadingRefs ? (
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>Loading…</p>
      ) : activeCases.length === 0 ? (
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic' }}>No active cases</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activeCases.slice(0, 8).map((r) => {
            const patient = resolvePatient?.(r.patient_id);
            const name = patient && typeof patient === 'object'
              ? `${patient.first_name || ''} ${patient.last_name || ''}`.trim()
              : (typeof patient === 'string' && patient !== '—' ? patient : r.patient_id);
            return (
              <div key={r._id || r.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                padding: '10px 12px', borderRadius: 8, border: '1px solid var(--color-border)',
              }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name || 'Patient'}
                  </p>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    {r.division && <DivisionBadge division={r.division} />}
                    {r.current_stage && <StageBadge stage={r.current_stage} />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AccessSection({ user, roles, statusStyle, onRequestRoleChange, onStatusChange }) {
  const selectStyle = {
    width: '100%', padding: '10px 12px', borderRadius: 8,
    border: '1px solid var(--color-border)', background: palette.backgroundLight.hex,
    fontSize: 13.5, color: palette.backgroundDark.hex, fontFamily: 'inherit', cursor: 'pointer',
  };

  return (
    <div>
      <SectionTitle
        title="Access"
        hint="Role controls the default permission preset. Status controls whether they can sign in and work cases."
      />
      <label style={{ display: 'block', marginBottom: 16 }}>
        <span style={{ display: 'block', fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 6 }}>
          Role
        </span>
        <select
          value={user.role_id || ''}
          onChange={(e) => onRequestRoleChange(e.target.value)}
          style={selectStyle}
        >
          {!user.role_id && <option value="">— select role —</option>}
          {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      <label style={{ display: 'block' }}>
        <span style={{ display: 'block', fontSize: 11.5, fontWeight: 650, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 6 }}>
          Status
        </span>
        <select
          value={user.status || 'Active'}
          onChange={(e) => onStatusChange(e.target.value)}
          style={{ ...selectStyle, background: statusStyle.bg, color: statusStyle.text, fontWeight: 650, border: 'none' }}
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    </div>
  );
}

function LanguagesSection({ user, catalog, existing, onToast }) {
  const [selected, setSelected] = useState(() => new Set(existing.map((r) => r.language_id)));
  const [saving, setSaving] = useState(false);
  const synced = useRef(null);

  useEffect(() => {
    if (synced.current === user.id) return;
    synced.current = user.id;
    setSelected(new Set(existing.map((r) => r.language_id)));
  }, [user.id, existing]);

  const initial = useMemo(() => new Set(existing.map((r) => r.language_id)), [existing]);
  const dirty = (() => {
    if (selected.size !== initial.size) return true;
    for (const id of selected) if (!initial.has(id)) return true;
    return false;
  })();

  function toggle(langId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(langId)) next.delete(langId); else next.add(langId);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { created, removed, kept } = await syncUserLanguages(user.id, [...selected], existing);
      removed.forEach((id) => removeEntity('userLanguages', id));
      if (created.length) {
        const map = {};
        created.forEach((r) => { map[r._id] = r; });
        mergeEntities('userLanguages', map);
      }
      // Refresh kept that weren't removed — store already has them
      void kept;
      onToast?.('Languages saved');
      synced.current = null; // allow re-sync from store
    } catch (err) {
      onToast?.(`Failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SectionTitle
        title="Languages"
        hint="Languages this person speaks. Used to match staff with patients by preferred language."
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {catalog.map((lang) => {
          const on = selected.has(lang.id);
          return (
            <button
              key={lang.id}
              type="button"
              onClick={() => toggle(lang.id)}
              style={{
                padding: '7px 12px', borderRadius: 20, cursor: 'pointer',
                fontSize: 12.5, fontWeight: 600,
                border: on ? `1.5px solid ${palette.primaryMagenta.hex}` : '1px solid var(--color-border)',
                background: on ? hexToRgba(palette.primaryMagenta.hex, 0.1) : palette.backgroundLight.hex,
                color: on ? palette.primaryMagenta.hex : palette.backgroundDark.hex,
              }}
            >
              {lang.name}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
          {selected.size === 0 ? 'No languages selected' : `${selected.size} selected`}
          {dirty && <span style={{ color: palette.primaryMagenta.hex, fontWeight: 600, marginLeft: 8 }}>Unsaved</span>}
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 650,
            background: (saving || !dirty) ? hexToRgba(palette.primaryMagenta.hex, 0.3) : palette.primaryMagenta.hex,
            color: palette.backgroundLight.hex,
            cursor: (saving || !dirty) ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save languages'}
        </button>
      </div>
    </div>
  );
}

function CocFacilitiesSection({ user, facilities, existing, onToast }) {
  const [selected, setSelected] = useState(() => new Set(existing.map((r) => r.facility_id)));
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const synced = useRef(null);

  useEffect(() => {
    if (synced.current === user.id) return;
    synced.current = user.id;
    setSelected(new Set(existing.map((r) => r.facility_id)));
    setQuery('');
  }, [user.id, existing]);

  const initial = useMemo(() => new Set(existing.map((r) => r.facility_id)), [existing]);
  const dirty = (() => {
    if (selected.size !== initial.size) return true;
    for (const id of selected) if (!initial.has(id)) return true;
    return false;
  })();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return facilities;
    return facilities.filter((f) => String(f.name || '').toLowerCase().includes(q)
      || String(f.id || '').toLowerCase().includes(q));
  }, [facilities, query]);

  function toggle(facId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(facId)) next.delete(facId); else next.add(facId);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { created, removed } = await syncCocNurseFacilities(user.id, [...selected], existing);
      removed.forEach((id) => removeEntity('cocNurseFacilities', id));
      if (created.length) {
        const map = {};
        created.forEach((r) => { map[r._id] = r; });
        mergeEntities('cocNurseFacilities', map);
      }
      onToast?.('COC facilities saved');
      synced.current = null;
    } catch (err) {
      onToast?.(`Failed: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SectionTitle
        title="COC Facilities"
        hint="Facilities where this person is the Continuity of Care (COC) nurse. On Lead Entry, choosing one of these facilities will auto-assign them (or prompt to pick if several nurses share the facility)."
      />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search facilities…"
        style={{
          width: '100%', boxSizing: 'border-box', marginBottom: 12,
          padding: '8px 11px', borderRadius: 8, border: '1px solid var(--color-border)',
          fontSize: 13, fontFamily: 'inherit', outline: 'none',
          background: hexToRgba(palette.backgroundDark.hex, 0.03),
          color: palette.backgroundDark.hex,
        }}
      />
      {facilities.length === 0 ? (
        <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), fontStyle: 'italic', marginBottom: 16 }}>
          No network facilities loaded.
        </p>
      ) : (
        <div style={{
          maxHeight: 320, overflowY: 'auto', marginBottom: 16,
          border: '1px solid var(--color-border)', borderRadius: 10,
        }}>
          {filtered.length === 0 ? (
            <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4), padding: 14, margin: 0 }}>
              No matches for “{query}”
            </p>
          ) : filtered.map((fac, idx) => {
            const on = selected.has(fac.id);
            return (
              <button
                key={fac.id}
                type="button"
                onClick={() => toggle(fac.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                  border: 'none',
                  borderBottom: idx === filtered.length - 1 ? 'none' : '1px solid var(--color-border)',
                  background: on ? hexToRgba(palette.primaryMagenta.hex, 0.06) : 'transparent',
                  color: palette.backgroundDark.hex, fontFamily: 'inherit',
                }}
              >
                <span style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                  border: on ? `1.5px solid ${palette.primaryMagenta.hex}` : '1.5px solid var(--color-border)',
                  background: on ? palette.primaryMagenta.hex : 'transparent',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {on && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6.5l2.5 2.5L10 3.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span style={{ fontSize: 13, fontWeight: on ? 650 : 500 }}>{fac.name}</span>
              </button>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
          {selected.size === 0 ? 'No facilities assigned' : `${selected.size} ${selected.size === 1 ? 'facility' : 'facilities'}`}
          {dirty && <span style={{ color: palette.primaryMagenta.hex, fontWeight: 600, marginLeft: 8 }}>Unsaved</span>}
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          style={{
            padding: '8px 18px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 650,
            background: (saving || !dirty) ? hexToRgba(palette.primaryMagenta.hex, 0.3) : palette.primaryMagenta.hex,
            color: palette.backgroundLight.hex,
            cursor: (saving || !dirty) ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save COC facilities'}
        </button>
      </div>
    </div>
  );
}

function PermissionsSection({ user, existingRecord, presets, appUserId, onToast }) {
  const initialPerms = useMemo(() => {
    if (!existingRecord?.permissions) return new Set(ALL_PERM_KEYS);
    try {
      const arr = typeof existingRecord.permissions === 'string'
        ? JSON.parse(existingRecord.permissions)
        : existingRecord.permissions;
      return new Set(Array.isArray(arr) ? arr : ALL_PERM_KEYS);
    } catch {
      return new Set(ALL_PERM_KEYS);
    }
  }, [existingRecord]);

  const [checked, setChecked] = useState(() => new Set(initialPerms));
  const [selectedPreset, setSelectedPreset] = useState(existingRecord?.last_preset_id || '');
  const [saving, setSaving] = useState(false);
  const synced = useRef(null);

  useEffect(() => {
    if (synced.current === user.id) return;
    synced.current = user.id;
    setChecked(new Set(initialPerms));
    setSelectedPreset(existingRecord?.last_preset_id || '');
  }, [user.id, initialPerms, existingRecord?.last_preset_id]);

  const presetKeys = useMemo(() => {
    const preset = presets.find((p) => p.id === selectedPreset);
    if (!preset?.permissions) return null;
    try {
      const arr = typeof preset.permissions === 'string' ? JSON.parse(preset.permissions) : preset.permissions;
      return new Set(Array.isArray(arr) ? arr : []);
    } catch { return null; }
  }, [selectedPreset, presets]);

  function toggle(key) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleCategory(cat) {
    const catKeys = PERMISSION_CATALOG.filter((p) => p.category === cat).map((p) => p.key);
    const allChecked = catKeys.every((k) => checked.has(k));
    setChecked((prev) => {
      const next = new Set(prev);
      catKeys.forEach((k) => (allChecked ? next.delete(k) : next.add(k)));
      return next;
    });
  }

  function applyPreset() {
    const preset = presets.find((p) => p.id === selectedPreset);
    if (!preset) return;
    try {
      const keys = typeof preset.permissions === 'string' ? JSON.parse(preset.permissions) : preset.permissions;
      setChecked(new Set(Array.isArray(keys) ? keys : []));
    } catch { /* ignore */ }
  }

  const hasChanges = (() => {
    if (checked.size !== initialPerms.size) return true;
    for (const k of checked) if (!initialPerms.has(k)) return true;
    return false;
  })();

  async function handleSave() {
    setSaving(true);
    const permsJson = JSON.stringify([...checked]);
    const now = new Date().toISOString();
    try {
      if (existingRecord?._id) {
        const fields = { permissions: permsJson, last_preset_id: selectedPreset || '', updated_at: now, updated_by: appUserId || '' };
        await updateUserPermission(existingRecord._id, fields);
        mergeEntities('userPermissions', { [existingRecord._id]: { ...existingRecord, ...fields } });
      } else {
        const fields = { id: `up_${user.id}`, user_id: user.id, permissions: permsJson, last_preset_id: selectedPreset || '', updated_at: now, updated_by: appUserId || '' };
        const rec = await createUserPermission(fields);
        mergeEntities('userPermissions', { [rec.id]: { _id: rec.id, ...rec.fields } });
      }
      onToast?.('Permissions saved');
      synced.current = null;
    } catch (err) {
      onToast?.(`Error: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
      <SectionTitle title="Permissions" hint="Search or jump by section. Start from a preset, then fine-tune." />
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', flexShrink: 0 }}>
        <select
          value={selectedPreset}
          onChange={(e) => setSelectedPreset(e.target.value)}
          style={{
            flex: 1, minWidth: 160, padding: '8px 10px', borderRadius: 8,
            border: '1px solid var(--color-border)', fontSize: 12.5, fontFamily: 'inherit',
          }}
        >
          <option value="">— no preset —</option>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="button" onClick={applyPreset} disabled={!selectedPreset} style={{
          padding: '8px 14px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 650,
          background: selectedPreset ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.08),
          color: selectedPreset ? palette.backgroundLight.hex : hexToRgba(palette.backgroundDark.hex, 0.3),
          cursor: selectedPreset ? 'pointer' : 'not-allowed',
        }}>
          Apply
        </button>
        <button type="button" onClick={() => setChecked(new Set(ALL_PERM_KEYS))} style={ghostBtn}>All</button>
        <button type="button" onClick={() => setChecked(new Set())} style={ghostBtn}>None</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <PermissionChecklist
          checked={checked}
          onToggle={toggle}
          onToggleCategory={toggleCategory}
          presetKeys={presetKeys}
          showDescriptions
          autoFocusSearch
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 14, borderTop: '1px solid var(--color-border)', flexShrink: 0 }}>
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
          {checked.size} of {ALL_PERM_KEYS.length}
          {hasChanges && <span style={{ color: palette.primaryMagenta.hex, fontWeight: 600, marginLeft: 8 }}>Unsaved</span>}
        </p>
        <button type="button" onClick={handleSave} disabled={saving || !hasChanges} style={{
          padding: '8px 18px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 650,
          background: (saving || !hasChanges) ? hexToRgba(palette.primaryMagenta.hex, 0.3) : palette.primaryMagenta.hex,
          color: palette.backgroundLight.hex, cursor: (saving || !hasChanges) ? 'not-allowed' : 'pointer',
        }}>
          {saving ? 'Saving…' : 'Save permissions'}
        </button>
      </div>
    </div>
  );
}

const ghostBtn = {
  padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-border)',
  background: 'none', fontSize: 11, fontWeight: 600,
  color: hexToRgba(palette.backgroundDark.hex, 0.5), cursor: 'pointer',
};

function AssignmentSection({ user, existingRecord, allUsers, departments, roles, appUserId, onToast }) {
  const initialAllowed = useMemo(() => {
    if (!existingRecord?.allowed_assignees) return null;
    try {
      const arr = typeof existingRecord.allowed_assignees === 'string'
        ? JSON.parse(existingRecord.allowed_assignees)
        : existingRecord.allowed_assignees;
      return Array.isArray(arr) ? new Set(arr) : null;
    } catch { return null; }
  }, [existingRecord]);

  const [restricted, setRestricted] = useState(() => !!initialAllowed);
  const [checked, setChecked] = useState(() => (initialAllowed ? new Set(initialAllowed) : new Set()));
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const synced = useRef(null);

  useEffect(() => {
    if (synced.current === user.id) return;
    synced.current = user.id;
    if (initialAllowed) {
      setRestricted(true);
      setChecked(new Set(initialAllowed));
    } else {
      setRestricted(false);
      setChecked(new Set());
    }
    setSearch('');
    setDeptFilter('');
  }, [user.id, initialAllowed]);

  const roleNameById = useMemo(() => {
    const map = {};
    Object.values(roles || {}).forEach((r) => { map[r.id] = r.name || r.id; });
    return map;
  }, [roles]);

  const activeUsers = useMemo(
    () => allUsers
      .filter((u) => (u.status === 'Active' || !u.status) && u.id !== user.id)
      .sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [allUsers, user.id],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeUsers.filter((u) => {
      if (deptFilter === '_none') {
        if (u.department_id) return false;
      } else if (deptFilter && (u.department_id || '') !== deptFilter) {
        return false;
      }
      if (!q) return true;
      return `${u.first_name || ''} ${u.last_name || ''} ${u.email || ''}`.toLowerCase().includes(q);
    });
  }, [activeUsers, search, deptFilter]);

  const hasChanges = (() => {
    if (!restricted) return initialAllowed !== null;
    if (initialAllowed === null) return true;
    if (checked.size !== initialAllowed.size) return true;
    for (const k of checked) if (!initialAllowed.has(k)) return true;
    return false;
  })();

  async function handleSave() {
    setSaving(true);
    const allowedJson = restricted ? JSON.stringify([...checked]) : '';
    const now = new Date().toISOString();
    try {
      if (existingRecord?._id) {
        const fields = { allowed_assignees: allowedJson, updated_at: now, updated_by: appUserId || '' };
        await updateUserPermission(existingRecord._id, fields);
        mergeEntities('userPermissions', { [existingRecord._id]: { ...existingRecord, ...fields } });
      } else {
        const fields = { id: `up_${user.id}`, user_id: user.id, allowed_assignees: allowedJson, updated_at: now, updated_by: appUserId || '' };
        const rec = await createUserPermission(fields);
        mergeEntities('userPermissions', { [rec.id]: { _id: rec.id, ...rec.fields } });
      }
      onToast?.('Assignment settings saved');
      synced.current = null;
    } catch (err) {
      onToast?.(`Error: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SectionTitle
        title="Assignment"
        hint="Who this person can assign tasks and case ownership to."
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={restricted}
          onChange={(e) => { setRestricted(e.target.checked); if (!e.target.checked) setChecked(new Set()); }}
          style={{ accentColor: palette.primaryMagenta.hex, width: 15, height: 15 }}
        />
        <span style={{ fontSize: 13.5, fontWeight: 600, color: palette.backgroundDark.hex }}>
          Restrict to specific people
        </span>
      </label>

      {!restricted ? (
        <p style={{ fontSize: 13.5, color: hexToRgba(palette.backgroundDark.hex, 0.55), lineHeight: 1.5, marginBottom: 16 }}>
          They can assign to any active teammate.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              style={{
                flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-border)',
                fontSize: 13, fontFamily: 'inherit',
              }}
            />
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 12.5, fontFamily: 'inherit' }}
            >
              <option value="">All departments</option>
              {departments.sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
              <option value="_none">No department</option>
            </select>
          </div>
          <div style={{
            maxHeight: 320, overflowY: 'auto', border: '1px solid var(--color-border)',
            borderRadius: 10, marginBottom: 14,
          }}>
            {filtered.map((u) => {
              const on = checked.has(u.id);
              return (
                <label
                  key={u.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
                    borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}`,
                    cursor: 'pointer', background: on ? hexToRgba(palette.primaryMagenta.hex, 0.04) : 'transparent',
                  }}
                >
                  <input type="checkbox" checked={on} onChange={() => {
                    setChecked((prev) => {
                      const next = new Set(prev);
                      if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
                      return next;
                    });
                  }} style={{ accentColor: palette.primaryMagenta.hex }} />
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: palette.backgroundDark.hex }}>{displayName(u)}</p>
                    <p style={{ fontSize: 11.5, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>
                      {roleNameById[u.role_id] || '—'}
                    </p>
                  </div>
                </label>
              );
            })}
            {filtered.length === 0 && (
              <p style={{ padding: 16, fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.4) }}>No matches</p>
            )}
          </div>
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>
          {restricted ? `${checked.size} people` : 'Everyone'}
          {hasChanges && <span style={{ color: palette.primaryMagenta.hex, fontWeight: 600, marginLeft: 8 }}>Unsaved</span>}
        </p>
        <button type="button" onClick={handleSave} disabled={saving || !hasChanges} style={{
          padding: '8px 18px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 650,
          background: (saving || !hasChanges) ? hexToRgba(palette.primaryMagenta.hex, 0.3) : palette.primaryMagenta.hex,
          color: palette.backgroundLight.hex, cursor: (saving || !hasChanges) ? 'not-allowed' : 'pointer',
        }}>
          {saving ? 'Saving…' : 'Save assignment'}
        </button>
      </div>
    </div>
  );
}
