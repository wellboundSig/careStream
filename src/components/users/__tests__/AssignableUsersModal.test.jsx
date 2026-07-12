import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../hooks/useCurrentAppUser.js', () => ({
  useCurrentAppUser: () => ({ appUserId: 'admin_1' }),
}));

vi.mock('../../../api/userPermissions.js', () => ({
  updateUserPermission: vi.fn().mockResolvedValue({}),
  createUserPermission: vi.fn().mockResolvedValue({ id: 'rec_new', fields: { id: 'up_usr_target', user_id: 'usr_target' } }),
}));

const mockStore = {
  users: {
    u1: { _id: 'u1', id: 'usr_A', first_name: 'Alice', last_name: 'Smith', role_id: 'rol_1', department_id: 'dept_1', status: 'Active', email: 'a@x.com' },
    u2: { _id: 'u2', id: 'usr_B', first_name: 'Bob', last_name: 'Jones', role_id: 'rol_1', department_id: 'dept_1', status: 'Active', email: 'b@x.com' },
    u3: { _id: 'u3', id: 'usr_C', first_name: 'Carol', last_name: 'Lee', role_id: 'rol_2', department_id: 'dept_2', status: 'Active', email: 'c@x.com' },
    u4: { _id: 'u4', id: 'usr_target', first_name: 'Target', last_name: 'User', role_id: 'rol_1', department_id: 'dept_1', status: 'Active' },
  },
  roles: {
    r1: { _id: 'r1', id: 'rol_1', name: 'Intake' },
    r2: { _id: 'r2', id: 'rol_2', name: 'Clinical' },
  },
  departments: {
    d1: { _id: 'd1', id: 'dept_1', name: 'Intake Ops' },
    d2: { _id: 'd2', id: 'dept_2', name: 'Clinical' },
  },
  userPermissions: {},
};

vi.mock('../../../store/careStore.js', () => ({
  useCareStore: (selector) => selector(mockStore),
  mergeEntities: vi.fn(),
}));

const { default: AssignableUsersModal } = await import('../AssignableUsersModal.jsx');
const { createUserPermission, updateUserPermission } = await import('../../../api/userPermissions.js');

const targetUser = { id: 'usr_target', first_name: 'Target', last_name: 'User' };

function restrict() { fireEvent.click(screen.getByText('Restrict to specific people')); }

describe('AssignableUsersModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.userPermissions = {};
  });

  it('defaults to unrestricted Everyone', () => {
    render(<AssignableUsersModal user={targetUser} onClose={() => {}} />);
    expect(screen.getByText('Everyone')).toBeTruthy();
    expect(screen.getByText(/any active team member/i)).toBeTruthy();
  });

  it('excludes the target user and groups by department when restricted', () => {
    render(<AssignableUsersModal user={targetUser} onClose={() => {}} />);
    restrict();
    expect(screen.getByTestId('dept-group-dept_1')).toBeTruthy();
    expect(screen.getByTestId('dept-group-dept_2')).toBeTruthy();
    expect(screen.getByText('Alice Smith')).toBeTruthy();
    expect(screen.queryByText('Target User')).toBeFalsy();
  });

  it('filters by search and department', () => {
    render(<AssignableUsersModal user={targetUser} onClose={() => {}} />);
    restrict();
    fireEvent.change(screen.getByPlaceholderText(/search by name or email/i), { target: { value: 'carol' } });
    expect(screen.getByText('Carol Lee')).toBeTruthy();
    expect(screen.queryByText('Alice Smith')).toBeFalsy();

    fireEvent.change(screen.getByPlaceholderText(/search by name or email/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/filter by department/i), { target: { value: 'dept_2' } });
    expect(screen.getByText('Carol Lee')).toBeTruthy();
    expect(screen.queryByText('Alice Smith')).toBeFalsy();
  });

  it('does not write empty permissions when creating a new UserPermissions row', async () => {
    render(<AssignableUsersModal user={targetUser} onClose={() => {}} />);
    restrict();
    fireEvent.click(screen.getByText('Alice Smith').closest('label').querySelector('input'));
    fireEvent.click(screen.getByText('Save'));
    await vi.waitFor(() => expect(createUserPermission).toHaveBeenCalled());
    const fields = createUserPermission.mock.calls[0][0];
    expect(fields.permissions).toBeUndefined();
    expect(fields.allowed_assignees).toContain('usr_A');
  });

  it('PATCHes only allowed_assignees when a record already exists', async () => {
    mockStore.userPermissions = {
      up1: { _id: 'up1', user_id: 'usr_target', permissions: '["task.view"]', allowed_assignees: '["usr_A"]' },
    };
    render(<AssignableUsersModal user={targetUser} onClose={() => {}} />);
    // Already restricted with Alice; add Bob
    const bob = screen.getByText('Bob Jones').closest('label').querySelector('input');
    fireEvent.click(bob);
    fireEvent.click(screen.getByText('Save'));
    await vi.waitFor(() => expect(updateUserPermission).toHaveBeenCalled());
    const [, fields] = updateUserPermission.mock.calls[0];
    expect(fields.permissions).toBeUndefined();
    expect(fields.allowed_assignees).toContain('usr_B');
  });
});
