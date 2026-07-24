export type WorkspaceRole = 'owner' | 'admin' | 'manager' | 'agent' | 'finance' | 'viewer';

export type NavPage =
  | 'home'
  | 'crm'
  | 'listings'
  | 'deals'
  | 'viewings'
  | 'tenancies'
  | 'commercial'
  | 'collections'
  | 'documents'
  | 'legal'
  | 'contractors'
  | 'mapLocation'
  | 'aiCentre'
  | 'dashboard'
  | 'contacts'
  | 'settings';

export const NAV_ACCESS: Record<NavPage, WorkspaceRole[]> = {
  home:        ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
  crm:         ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
  listings:    ['owner', 'admin', 'manager', 'agent'],
  deals:       ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
  viewings:    ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
  dashboard:   ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
  tenancies:   ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
  documents:   ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
  collections: ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
  commercial:  ['owner', 'admin', 'manager', 'agent'],
  legal:       ['owner', 'admin', 'manager', 'agent'],
  contractors: ['owner', 'admin', 'manager', 'agent'],
  mapLocation: ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
  aiCentre:    ['owner', 'admin', 'manager', 'agent'],
  contacts:    ['owner', 'admin', 'manager', 'agent', 'finance', 'viewer'],
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
