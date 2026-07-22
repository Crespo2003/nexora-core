export type WorkspaceRole = 'owner' | 'admin' | 'manager' | 'agent' | 'finance' | 'viewer';

export type NavPage = 'dashboard' | 'tenancies' | 'documents' | 'collections' | 'commercial' | 'settings';

export const NAV_ACCESS: Record<NavPage, WorkspaceRole[]> = {
  dashboard:   ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
  tenancies:   ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
  documents:   ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
  collections: ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
  commercial:  ['owner', 'admin', 'manager', 'agent'],
  settings:    ['owner', 'admin'],
};

export function canAccess(role: WorkspaceRole, page: NavPage): boolean {
  return NAV_ACCESS[page].includes(role);
}

export const ROLE_LABELS: Record<WorkspaceRole, string> = {
  owner:   'Owner',
  admin:   'Admin',
  manager: 'Property Manager',
  agent:   'Agent',
  finance: 'Accountant',
  viewer:  'Viewer',
};
