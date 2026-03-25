import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../hooks/useCurrentAppUser.js', () => ({
  useCurrentAppUser: () => ({ appUserId: 'admin_1' }),
}));

vi.mock('../../../hooks/useLookups.js', () => ({
  useLookups: () => ({ resolveRole: (id) => id === 'rol_1' ? 'Intake' : id === 'rol_2' ? 'Clinical' : id }),
}));

vi.mock('../../../api/userPermissions.js', () => ({
  updateUserPermission: vi.fn().mockResolvedValue({}),
  createUserPermission: vi.fn().mockResolvedValue({ id: 'rec_new', fields: {} }),
}));

const mockStore = {
  users: {
    u1: { _id: 'u1', id: 'usr_A', first_name: 'Alice', last_name: 'Smith', role_id: 'rol_1', status: 'Active' },
    u2: { _id: 'u2', id: 'usr_B', first_name: 'Bob', last_name: 'Jones', role_id: 'rol_1', status: 'Active' },
    u3: { _id: 'u3', id: 'usr_C', first_name: 'Carol', last_name: 'Lee', role_id: 'rol_2', status: 'Active' },
    u4: { _id: 'u4', id: 'usr_target', first_name: 'Target', last_name: 'User', role_id: 'rol_1', status: 'Active' },
  },
  roles: {
    r1: { _id: 'r1', id: 'rol_1', name: 'Intake' },
    r2: { _id: 'r2', id: 'rol_2', name: 'Clinical' },
  },
  userPermissions: {},
};

vi.mock('../../../store/careStore.js', () => ({
  useCareStore: (selector) => selector(mockStore),
  mergeEntities: vi.fn(),
}));

const { default: AssigneePermissionEditor } = await import('../AssigneePermissionEditor.jsx');

const targetUser = { id: 'usr_target', first_name: 'Target', last_name: 'User' };

describe('AssigneePermissionEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.userPermissions = {};
  });

  it('renders users grouped by role in restricted mode', () => {
    render(<AssigneePermissionEditor user={targetUser} />);
    fireEvent.click(screen.getByText('Restricted'));
    expect(screen.getByText('Intake')).toBeTruthy();
    expect(screen.getByText('Clinical')).toBeTruthy();
    expect(screen.getByText('Alice Smith')).toBeTruthy();
    expect(screen.getByText('Bob Jones')).toBeTruthy();
    expect(screen.getByText('Carol Lee')).toBeTruthy();
  });

  it('excludes the target user from their own assignee list', () => {
    render(<AssigneePermissionEditor user={targetUser} />);
    expect(screen.queryByText('Target User')).toBeFalsy();
  });

  it('starts in unrestricted mode by default', () => {
    render(<AssigneePermissionEditor user={targetUser} />);
    expect(screen.getByText(/can assign tasks and ownership to any/i)).toBeTruthy();
  });

  it('shows checkboxes in restricted mode', () => {
    render(<AssigneePermissionEditor user={targetUser} />);
    fireEvent.click(screen.getByText('Restricted'));
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(3);
  });

  it('supports individual checkbox selection', () => {
    render(<AssigneePermissionEditor user={targetUser} />);
    fireEvent.click(screen.getByText('Restricted'));
    fireEvent.click(screen.getByText('Select None'));

    const aliceCheckbox = screen.getByText('Alice Smith').closest('label').querySelector('input');
    expect(aliceCheckbox.checked).toBe(false);
    fireEvent.click(aliceCheckbox);
    expect(aliceCheckbox.checked).toBe(true);
  });

  it('supports bulk role-group selection', () => {
    render(<AssigneePermissionEditor user={targetUser} />);
    fireEvent.click(screen.getByText('Restricted'));
    fireEvent.click(screen.getByText('Select None'));

    const intakeGroup = screen.getByTestId('role-group-rol_1');
    const groupCheckbox = intakeGroup.querySelector('input[type="checkbox"]');
    fireEvent.click(groupCheckbox);

    const aliceCheckbox = screen.getByText('Alice Smith').closest('label').querySelector('input');
    const bobCheckbox = screen.getByText('Bob Jones').closest('label').querySelector('input');
    expect(aliceCheckbox.checked).toBe(true);
    expect(bobCheckbox.checked).toBe(true);

    const carolCheckbox = screen.getByText('Carol Lee').closest('label').querySelector('input');
    expect(carolCheckbox.checked).toBe(false);
  });

  it('renders "Select All" and "Select None" buttons', () => {
    render(<AssigneePermissionEditor user={targetUser} />);
    fireEvent.click(screen.getByText('Restricted'));
    expect(screen.getByText('Select All')).toBeTruthy();
    expect(screen.getByText('Select None')).toBeTruthy();
  });

  it('loads existing allowed_assignees from store', () => {
    mockStore.userPermissions = {
      up1: { _id: 'up1', user_id: 'usr_target', permissions: '[]', allowed_assignees: '["usr_A"]' },
    };
    render(<AssigneePermissionEditor user={targetUser} />);
    const aliceCheckbox = screen.getByText('Alice Smith').closest('label').querySelector('input');
    expect(aliceCheckbox.checked).toBe(true);
    const bobCheckbox = screen.getByText('Bob Jones').closest('label').querySelector('input');
    expect(bobCheckbox.checked).toBe(false);
  });
});
