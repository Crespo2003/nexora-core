import assert from 'node:assert/strict';
import test from 'node:test';
import { getTranslations } from '../lib/i18n/translations';
import { ALL_PORTAL_ITEMS, isPortalRouteActive, PORTAL_NAVIGATION, visiblePortalNavigation } from '../lib/portal/navigation';

test('home portal contains the required grouped workspace architecture', () => {
  assert.deepEqual(PORTAL_NAVIGATION.map((group) => group.key), ['business', 'operations', 'intelligence', 'administration']);
  assert.deepEqual(ALL_PORTAL_ITEMS.map((item) => item.key), [
    'home',
    'crm',
    'listings',
    'deals',
    'viewings',
    'tenancies',
    'commercial',
    'collections',
    'documents',
    'legal',
    'contractors',
    'mapLocation',
    'aiCentre',
    'dashboard',
    'contacts',
    'settings',
  ]);
});
test('existing modules map to their current routes', () => {
  const routes = Object.fromEntries(ALL_PORTAL_ITEMS.map((item) => [item.key, item.href]));
  assert.equal(routes.tenancies, '/');
  assert.equal(routes.commercial, '/commercial');
  assert.equal(routes.collections, '/collections');
  assert.equal(routes.documents, '/documents');
  assert.equal(routes.dashboard, '/dashboard');
  assert.equal(routes.settings, '/settings');
  assert.equal(routes.mapLocation, '/property-map');
});

test('portal navigation applies RBAC without removing permitted existing modules', () => {
  const owner = visiblePortalNavigation('owner').groups.flatMap((group) => group.items);
  const finance = visiblePortalNavigation('finance').groups.flatMap((group) => group.items);
  const viewer = visiblePortalNavigation('viewer').groups.flatMap((group) => group.items);

  assert.equal(owner.length, 15);
  assert.ok(finance.some((item) => item.key === 'collections'));
  assert.ok(finance.some((item) => item.key === 'documents'));
  assert.ok(!finance.some((item) => item.key === 'commercial'));
  assert.ok(!viewer.some((item) => item.key === 'settings'));
  assert.ok(viewer.some((item) => item.key === 'dashboard'));
});

test('every portal item and group has English and Simplified Chinese copy', () => {
  for (const language of ['en', 'zh'] as const) {
    const t = getTranslations(language);
    const nav = t.nav as Record<string, string>;
    for (const item of ALL_PORTAL_ITEMS) {
      assert.ok(nav[item.labelKey], `${language} navigation label missing for ${item.key}`);
      assert.ok(t.portal.descriptions[item.descriptionKey as keyof typeof t.portal.descriptions], `${language} description missing for ${item.key}`);
    }
    for (const group of PORTAL_NAVIGATION) {
      assert.ok(t.portal.groups[group.key], `${language} group label missing for ${group.key}`);
    }
  }
});

test('route matching handles the rental root without matching every route', () => {
  assert.equal(isPortalRouteActive('/', '/'), true);
  assert.equal(isPortalRouteActive('/home', '/'), false);
  assert.equal(isPortalRouteActive('/commercial/deals', '/commercial'), true);
  assert.equal(isPortalRouteActive('/commercially', '/commercial'), false);
});
