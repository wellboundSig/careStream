import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useCareStore } from '../store/careStore.js';
import { useCurrentAppUser } from '../hooks/useCurrentAppUser.js';
import DepartmentDashboard from '../components/departments/DepartmentDashboard.jsx';
import palette, { hexToRgba } from '../utils/colors.js';

export default function DepartmentDashboardPage() {
  const { deptId } = useParams();
  const storeDepts = useCareStore((s) => s.departments);
  const storeDeptScopes = useCareStore((s) => s.departmentScopes);
  const { appUserId } = useCurrentAppUser();

  const department = useMemo(() => {
    if (!deptId) return null;
    return Object.values(storeDepts || {}).find((d) => d.id === deptId) || null;
  }, [storeDepts, deptId]);

  const scope = useMemo(() => {
    if (!department?.department_scope_id) return null;
    return Object.values(storeDeptScopes || {}).find((s) => s.id === department.department_scope_id) || null;
  }, [storeDeptScopes, department]);

  if (!department) {
    return (
      <div style={{ padding: '60px 28px', textAlign: 'center' }}>
        <p style={{ fontSize: 15, fontWeight: 600, color: hexToRgba(palette.backgroundDark.hex, 0.45) }}>Department not found.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1400, margin: '0 auto' }}>
      <DepartmentDashboard department={department} scope={scope} />
    </div>
  );
}
