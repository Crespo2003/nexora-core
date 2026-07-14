import type { CommercialRole } from './types';

export function canCreateCommercialRecord(role: CommercialRole, resource: string) {
  if (['owner', 'admin', 'manager', 'agent'].includes(role)) return true;
  return role === 'finance' && resource === 'deals';
}

export function canManageAssignedCommercialRecord(role: CommercialRole, userId: string, assignedUserId?: string | null) {
  if (['owner', 'admin', 'manager'].includes(role)) return true;
  return role === 'agent' && assignedUserId === userId;
}

export function canExportCommercialRecords(role: CommercialRole) {
  return ['owner', 'admin', 'manager', 'agent', 'finance'].includes(role);
}
