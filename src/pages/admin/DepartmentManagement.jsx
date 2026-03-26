import { useState, useMemo } from 'react';
import { useCareStore, mergeEntities, removeEntity, updateEntity } from '../../store/careStore.js';
import { useLookups } from '../../hooks/useLookups.js';
import { usePermissions } from '../../hooks/usePermissions.js';
import { PERMISSION_KEYS } from '../../data/permissionKeys.js';
import { createDepartment, updateDepartment, deleteDepartment } from '../../api/departments.js';
import airtable from '../../api/airtable.js';
import { ALL_STAGES } from '../../data/stageConfig.js';
import AccessDenied from '../../components/common/AccessDenied.jsx';
import palette, { hexToRgba } from '../../utils/colors.js';

const lbl = { fontSize: 11.5, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'block', marginBottom: 5 };
const inp = { width: '100%', padding: '9px 12px', borderRadius: 8, border: 'none', fontSize: 13, fontFamily: 'inherit', outline: 'none', background: hexToRgba(palette.backgroundDark.hex, 0.05), color: palette.backgroundDark.hex, boxSizing: 'border-box', transition: 'box-shadow 0.15s' };
const inpFocus = `0 0 0 2px ${hexToRgba(palette.primaryMagenta.hex, 0.25)}`;

export default function DepartmentManagement() {
  const { can } = usePermissions();
  const { resolveUser } = useLookups();
  const storeDepts = useCareStore((s) => s.departments);
  const storeDeptScopes = useCareStore((s) => s.departmentScopes);
  const storeUsers = useCareStore((s) => s.users);

  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [toast, setToast] = useState(null);

  if (!can(PERMISSION_KEYS.ADMIN_DEPARTMENTS)) return <AccessDenied message="You do not have permission to manage departments." />;

  const departments = useMemo(() => Object.values(storeDepts || {}), [storeDepts]);
  const deptScopes = useMemo(() => Object.values(storeDeptScopes || {}), [storeDeptScopes]);
  const users = useMemo(() => Object.values(storeUsers || {}).filter((u) => u.status === 'Active' || !u.status).sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')), [storeUsers]);
  const deptMembers = useMemo(() => {
    const map = {};
    users.forEach((u) => { if (u.department_id) { if (!map[u.department_id]) map[u.department_id] = []; map[u.department_id].push(u); } });
    return map;
  }, [users]);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 2500); }

  async function handleDelete(dept) {
    try {
      await deleteDepartment(dept._id);
      removeEntity('departments', dept._id);
      setConfirmDelete(null);
      showToast('Department deleted');
    } catch { showToast('Failed to delete'); }
  }

  async function handleMemberChange(deptId, userId, add) {
    const user = users.find((u) => u.id === userId);
    if (!user) return;
    const newDeptId = add ? deptId : '';
    updateEntity('users', user._id, { department_id: newDeptId });
    airtable.update('Users', user._id, { department_id: newDeptId }).catch(() => {
      updateEntity('users', user._id, { department_id: user.department_id });
    });
  }

  return (
    <div style={{ padding: '28px 32px', maxWidth: 920, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 750, color: palette.backgroundDark.hex, marginBottom: 4 }}>Departments</h1>
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.42) }}>{departments.length} department{departments.length !== 1 ? 's' : ''} configured</p>
        </div>
        {!creating && (
          <button onClick={() => setCreating(true)} style={{ padding: '9px 18px', borderRadius: 8, background: palette.primaryDeepPlum.hex, border: 'none', fontSize: 13, fontWeight: 650, color: '#fff', cursor: 'pointer', transition: 'filter 0.12s' }}
            onMouseEnter={(e) => (e.currentTarget.style.filter = 'brightness(1.15)')}
            onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
          >+ New Department</button>
        )}
      </div>

      {creating && (
        <DeptForm users={users} scopes={deptScopes} deptMembers={{}} onMemberChange={() => {}} onSave={async (fields) => {
          const rec = await createDepartment(fields);
          mergeEntities('departments', { [rec.id]: { _id: rec.id, ...rec.fields } });
          setCreating(false);
          showToast('Department created');
        }} onCancel={() => setCreating(false)} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {departments.map((dept) => {
          const members = deptMembers[dept.id] || [];
          const scope = deptScopes.find((s) => s.id === dept.department_scope_id);
          const isEditing = editing === dept.id;

          if (isEditing) {
            return (
              <DeptForm key={dept.id} initial={dept} users={users} scopes={deptScopes}
                deptMembers={members} onMemberChange={(uid, add) => handleMemberChange(dept.id, uid, add)}
                onSave={async (fields) => {
                  await updateDepartment(dept._id, fields);
                  mergeEntities('departments', { [dept._id]: { ...dept, ...fields } });
                  setEditing(null);
                  showToast('Department updated');
                }} onCancel={() => setEditing(null)} />
            );
          }

          return (
            <div key={dept._id} style={{ padding: '20px 22px', borderRadius: 12, background: palette.backgroundLight.hex, boxShadow: `0 1px 4px ${hexToRgba(palette.backgroundDark.hex, 0.06)}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <p style={{ fontSize: 16, fontWeight: 700, color: palette.backgroundDark.hex }}>{dept.name}</p>
                    {dept.division && <span style={{ fontSize: 10.5, fontWeight: 650, padding: '2px 9px', borderRadius: 20, background: dept.division === 'Special Needs' ? hexToRgba(palette.primaryMagenta.hex, 0.1) : hexToRgba(palette.highlightYellow.hex, 0.18), color: dept.division === 'Special Needs' ? palette.primaryMagenta.hex : '#7A5F00' }}>{dept.division}</span>}
                  </div>
                  <p style={{ fontSize: 12.5, color: hexToRgba(palette.backgroundDark.hex, 0.45), marginBottom: 8 }}>
                    Supervisor: <strong style={{ fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.65) }}>{resolveUser(dept.supervisor)}</strong>
                    {scope && <> · Scope: {scope.name}</>}
                  </p>
                  {members.length > 0 && (
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                      {members.map((m) => (
                        <span key={m.id} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 20, background: hexToRgba(palette.backgroundDark.hex, 0.05), color: hexToRgba(palette.backgroundDark.hex, 0.6), fontWeight: 500 }}>
                          {m.first_name} {m.last_name}
                        </span>
                      ))}
                    </div>
                  )}
                  {members.length === 0 && <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.3), fontStyle: 'italic' }}>No members assigned</p>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 16 }}>
                  <button onClick={() => setEditing(dept.id)} style={{ padding: '6px 14px', borderRadius: 7, background: hexToRgba(palette.backgroundDark.hex, 0.05), border: 'none', fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.6), cursor: 'pointer', transition: 'background 0.12s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.09))}
                    onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.05))}
                  >Edit</button>
                  <button onClick={() => setConfirmDelete(dept)} style={{ padding: '6px 14px', borderRadius: 7, background: hexToRgba(palette.primaryMagenta.hex, 0.06), border: 'none', fontSize: 12, fontWeight: 600, color: palette.primaryMagenta.hex, cursor: 'pointer', transition: 'background 0.12s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryMagenta.hex, 0.12))}
                    onMouseLeave={(e) => (e.currentTarget.style.background = hexToRgba(palette.primaryMagenta.hex, 0.06))}
                  >Delete</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {confirmDelete && <DeleteConfirmModal dept={confirmDelete} onConfirm={() => handleDelete(confirmDelete)} onCancel={() => setConfirmDelete(null)} />}

      {toast && <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9997, background: palette.backgroundDark.hex, color: palette.backgroundLight.hex, padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 550, boxShadow: `0 4px 20px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, pointerEvents: 'none' }}>{toast}</div>}
    </div>
  );
}

function DeptForm({ initial, users, scopes, deptMembers, onMemberChange, onSave, onCancel }) {
  const [name, setName] = useState(initial?.name || '');
  const [supervisor, setSupervisor] = useState(initial?.supervisor || '');
  const [division, setDivision] = useState(initial?.division || '');
  const [scopeId, setScopeId] = useState(initial?.department_scope_id || '');
  const [saving, setSaving] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const canSubmit = name.trim() && supervisor && !saving;

  const currentMemberIds = new Set((deptMembers || []).map((m) => m.id));
  const unassigned = users.filter((u) => !u.department_id || currentMemberIds.has(u.id));

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const fields = {
        name: name.trim(), supervisor,
        ...(division && { division }),
        ...(scopeId && { department_scope_id: scopeId }),
        ...(!initial && { id: `dep_${Date.now().toString(36)}` }),
      };
      await onSave(fields);
    } catch { setSaving(false); }
  }

  return (
    <div style={{ padding: '22px 24px', borderRadius: 12, background: hexToRgba(palette.backgroundDark.hex, 0.02), marginBottom: 16 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: palette.primaryDeepPlum.hex, marginBottom: 16 }}>{initial ? 'Edit Department' : 'New Department'}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 18px', marginBottom: 16 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={lbl}>Department Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Intake, Clinical, Billing" style={inp} autoFocus
            onFocus={(e) => (e.target.style.boxShadow = inpFocus)} onBlur={(e) => (e.target.style.boxShadow = 'none')} />
        </div>
        <div>
          <label style={lbl}>Supervisor *</label>
          <select value={supervisor} onChange={(e) => setSupervisor(e.target.value)} style={{ ...inp, cursor: 'pointer' }}
            onFocus={(e) => (e.target.style.boxShadow = inpFocus)} onBlur={(e) => (e.target.style.boxShadow = 'none')}>
            <option value="">Select supervisor…</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Division</label>
          <select value={division} onChange={(e) => setDivision(e.target.value)} style={{ ...inp, cursor: 'pointer' }}
            onFocus={(e) => (e.target.style.boxShadow = inpFocus)} onBlur={(e) => (e.target.style.boxShadow = 'none')}>
            <option value="">Any</option>
            <option value="ALF">ALF</option>
            <option value="Special Needs">Special Needs</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Department Scope</label>
          <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} style={{ ...inp, cursor: 'pointer' }}
            onFocus={(e) => (e.target.style.boxShadow = inpFocus)} onBlur={(e) => (e.target.style.boxShadow = 'none')}>
            <option value="">No scope</option>
            {scopes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* Members section */}
      {initial && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <label style={{ ...lbl, marginBottom: 0 }}>Members ({(deptMembers || []).length})</label>
            <button onClick={() => setShowMembers((v) => !v)} style={{ fontSize: 11.5, fontWeight: 600, color: palette.primaryMagenta.hex, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              {showMembers ? 'Hide' : 'Manage members'}
            </button>
          </div>

          {/* Current member pills */}
          {(deptMembers || []).length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: showMembers ? 10 : 0 }}>
              {(deptMembers || []).map((m) => (
                <span key={m.id} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 20, background: hexToRgba(palette.primaryDeepPlum.hex, 0.07), color: palette.primaryDeepPlum.hex, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  {m.first_name} {m.last_name}
                  <button onClick={() => onMemberChange?.(m.id, false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: hexToRgba(palette.primaryMagenta.hex, 0.7), fontSize: 12, fontWeight: 800, padding: 0, lineHeight: 1 }} title="Remove">×</button>
                </span>
              ))}
            </div>
          )}

          {/* Add members dropdown */}
          {showMembers && (
            <div style={{ maxHeight: 200, overflowY: 'auto', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.03), padding: '4px 0' }}>
              {users.filter((u) => !u.department_id && !currentMemberIds.has(u.id)).length === 0 ? (
                <p style={{ fontSize: 12, color: hexToRgba(palette.backgroundDark.hex, 0.35), padding: '12px 14px', fontStyle: 'italic' }}>All active team members are already in a department.</p>
              ) : (
                users.filter((u) => !u.department_id && !currentMemberIds.has(u.id)).map((u) => (
                  <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 14px', cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = hexToRgba(palette.backgroundDark.hex, 0.05))}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    <input type="checkbox" checked={false} onChange={() => onMemberChange?.(u.id, true)} style={{ accentColor: palette.primaryMagenta.hex, width: 14, height: 14, cursor: 'pointer' }} />
                    <span style={{ fontSize: 12.5, color: palette.backgroundDark.hex }}>{u.first_name} {u.last_name}</span>
                    {u.email && <span style={{ fontSize: 11, color: hexToRgba(palette.backgroundDark.hex, 0.3), marginLeft: 'auto' }}>{u.email}</span>}
                  </label>
                ))
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={onCancel} style={{ padding: '8px 18px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.05), border: 'none', fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer' }}>Cancel</button>
        <button onClick={handleSubmit} disabled={!canSubmit} style={{ padding: '8px 22px', borderRadius: 8, background: canSubmit ? palette.primaryDeepPlum.hex : hexToRgba(palette.backgroundDark.hex, 0.08), border: 'none', fontSize: 13, fontWeight: 650, color: canSubmit ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.3), cursor: canSubmit ? 'pointer' : 'not-allowed', transition: 'filter 0.12s' }}
          onMouseEnter={(e) => canSubmit && (e.currentTarget.style.filter = 'brightness(1.15)')}
          onMouseLeave={(e) => (e.currentTarget.style.filter = 'none')}
        >{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ dept, onConfirm, onCancel }) {
  const [typed, setTyped] = useState('');
  const confirmed = typed === dept.name;
  return (
    <div onClick={(e) => e.target === e.currentTarget && onCancel()} style={{ position: 'fixed', inset: 0, zIndex: 9998, background: hexToRgba(palette.backgroundDark.hex, 0.5), display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: palette.backgroundLight.hex, borderRadius: 16, width: '100%', maxWidth: 420, boxShadow: `0 24px 64px ${hexToRgba(palette.backgroundDark.hex, 0.25)}`, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px 16px' }}>
          <p style={{ fontSize: 16, fontWeight: 700, color: palette.primaryMagenta.hex, marginBottom: 6 }}>Delete Department</p>
          <p style={{ fontSize: 13, color: hexToRgba(palette.backgroundDark.hex, 0.5), lineHeight: 1.5 }}>
            This will permanently delete <strong>{dept.name}</strong>. Members will lose their department assignment.
          </p>
        </div>
        <div style={{ padding: '0 24px 20px' }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), marginBottom: 8 }}>
            Type <strong style={{ color: palette.primaryMagenta.hex }}>{dept.name}</strong> to confirm:
          </p>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={dept.name} style={{ ...inp, boxShadow: confirmed ? `0 0 0 2px ${hexToRgba(palette.primaryMagenta.hex, 0.3)}` : 'none' }} autoFocus />
        </div>
        <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button onClick={onCancel} style={{ padding: '8px 18px', borderRadius: 8, background: hexToRgba(palette.backgroundDark.hex, 0.05), border: 'none', fontSize: 13, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.55), cursor: 'pointer' }}>Cancel</button>
          <button onClick={onConfirm} disabled={!confirmed} style={{ padding: '8px 22px', borderRadius: 8, background: confirmed ? palette.primaryMagenta.hex : hexToRgba(palette.backgroundDark.hex, 0.08), border: 'none', fontSize: 13, fontWeight: 650, color: confirmed ? '#fff' : hexToRgba(palette.backgroundDark.hex, 0.3), cursor: confirmed ? 'pointer' : 'not-allowed' }}>Delete Permanently</button>
        </div>
      </div>
    </div>
  );
}
