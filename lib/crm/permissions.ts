import type { WorkspaceRole } from '../rbac/permissions';

export function canReadCrm(role: WorkspaceRole) {
  return ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'].includes(role);
}

export function canCreateCrm(role: WorkspaceRole) {
  return ['owner', 'admin', 'agent'].includes(role);
}

export function canManageCrmRecord(
  role: WorkspaceRole,
  assignedUserId: string | null | undefined,
  currentUserId: string
) {
  if (['owner', 'admin'].includes(role)) return true;
  return role === 'agent' && assignedUserId === currentUserId;
}

export function canDeleteCrm(role: WorkspaceRole) {
  return role === 'owner' || role === 'admin';
}

export function maskCrmContact(value: string) {
  if (!value) return '';
  if (value.includes('@')) {
    const [local, domain] = value.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }
  const visible = value.replace(/\D/g, '').slice(-4);
  return visible ? `•••• ${visible}` : '••••';
}
