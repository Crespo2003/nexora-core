import type { NavPage, WorkspaceRole } from '../rbac/permissions';
import { canAccess } from '../rbac/permissions';

export type NavigationGroupKey = 'business' | 'operations' | 'intelligence' | 'administration';

export type PortalNavigationItem = {
  key: NavPage;
  href: string;
  labelKey: string;
  descriptionKey: string;
};

export type PortalNavigationGroup = {
  key: NavigationGroupKey;
  items: PortalNavigationItem[];
};

export const HOME_NAV_ITEM: PortalNavigationItem = {
  key: 'home',
  href: '/home',
  labelKey: 'home',
  descriptionKey: 'home',
};

export const PORTAL_NAVIGATION: PortalNavigationGroup[] = [
  {
    key: 'business',
    items: [
      { key: 'crm', href: '/crm', labelKey: 'crm', descriptionKey: 'crm' },
      { key: 'listings', href: '/listings', labelKey: 'listings', descriptionKey: 'listings' },
      { key: 'deals', href: '/deals', labelKey: 'deals', descriptionKey: 'deals' },
      { key: 'viewings', href: '/viewings', labelKey: 'viewingsAppointments', descriptionKey: 'viewings' },
      { key: 'tenancies', href: '/', labelKey: 'rentalManagement', descriptionKey: 'tenancies' },
      { key: 'commercial', href: '/commercial', labelKey: 'commercial', descriptionKey: 'commercial' },
    ],
  },
  {
    key: 'operations',
    items: [
      { key: 'collections', href: '/collections', labelKey: 'financeCollections', descriptionKey: 'collections' },
      { key: 'documents', href: '/documents', labelKey: 'documents', descriptionKey: 'documents' },
      { key: 'legal', href: '/legal', labelKey: 'legal', descriptionKey: 'legal' },
      { key: 'contractors', href: '/contractors', labelKey: 'contractors', descriptionKey: 'contractors' },
    ],
  },
  {
    key: 'intelligence',
    items: [
      { key: 'mapLocation', href: '/property-map', labelKey: 'mapLocation', descriptionKey: 'mapLocation' },
      { key: 'aiCentre', href: '/ai-centre', labelKey: 'aiCentre', descriptionKey: 'aiCentre' },
      { key: 'dashboard', href: '/dashboard', labelKey: 'reportsAnalytics', descriptionKey: 'dashboard' },
    ],
  },
  {
    key: 'administration',
    items: [
      { key: 'contacts', href: '/contacts', labelKey: 'contacts', descriptionKey: 'contacts' },
      { key: 'settings', href: '/settings', labelKey: 'settings', descriptionKey: 'settings' },
    ],
  },
];

export const ALL_PORTAL_ITEMS = [HOME_NAV_ITEM, ...PORTAL_NAVIGATION.flatMap((group) => group.items)];

export function visiblePortalNavigation(role: WorkspaceRole) {
  return {
    home: canAccess(role, HOME_NAV_ITEM.key) ? HOME_NAV_ITEM : null,
    groups: PORTAL_NAVIGATION.map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccess(role, item.key)),
    })).filter((group) => group.items.length > 0),
  };
}
export function isPortalRouteActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
