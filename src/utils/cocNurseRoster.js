/** COC Nurse role — word boundary so "Clinical" does not match. */
export const COC_ROLE_NAME_RE = /\bcoc\b/i;

export function isCocNurseRoleName(name) {
  return COC_ROLE_NAME_RE.test(String(name || ''));
}

export function cocRoleIds(roles = {}) {
  return Object.values(roles)
    .filter((r) => isCocNurseRoleName(r?.name))
    .map((r) => String(r.id || '').trim())
    .filter(Boolean);
}

export function cocNurseDisplayName(user) {
  const name = `${user?.first_name || ''} ${user?.last_name || ''}`.trim();
  return name || user?.email || user?.id || 'Unknown';
}

/**
 * Roster of every user with the COC Nurse role, plus their facility assignments.
 * Unassigned nurses sort first, then by name.
 */
export function listCocNurseRoster({
  users = {},
  roles = {},
  cocNurseFacilities = {},
  resolveFacility,
} = {}) {
  const roleIds = new Set(cocRoleIds(roles));
  const facIdsByUser = {};
  for (const link of Object.values(cocNurseFacilities || {})) {
    const uid = String(link?.user_id || '').trim();
    const fid = String(link?.facility_id || '').trim();
    if (!uid || !fid) continue;
    if (!facIdsByUser[uid]) facIdsByUser[uid] = [];
    facIdsByUser[uid].push(fid);
  }

  return Object.values(users || {})
    .filter((u) => u?.id && roleIds.has(String(u.role_id || '').trim()))
    .map((u) => {
      const ids = [...new Set(facIdsByUser[String(u.id).trim()] || [])];
      const facilities = ids
        .map((id) => {
          const resolved = typeof resolveFacility === 'function' ? resolveFacility(id) : null;
          const name = (resolved && resolved !== '—') ? resolved : id;
          return { id, name };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        userId: u.id,
        recId: u._id,
        name: cocNurseDisplayName(u),
        email: u.email || '',
        status: u.status || 'Active',
        assigned: facilities.length > 0,
        facilities,
      };
    })
    .sort((a, b) => {
      if (a.assigned !== b.assigned) return a.assigned ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
}
