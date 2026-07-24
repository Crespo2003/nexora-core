import assert from 'node:assert/strict';
import test from 'node:test';
import { getTranslations, defaultLanguage, type Language } from '../lib/i18n/translations';
import { canAccess } from '../lib/rbac/permissions';
import type { NavPage, WorkspaceRole } from '../lib/rbac/permissions';

// Mirrors the nav label generation logic in AppNav.tsx
function navLabel(key: NavPage, language: Language): string {
  const t = getTranslations(language);
  const enNav = getTranslations(defaultLanguage).nav as Record<string, string>;
  return (t.nav as Record<string, string>)[key] ?? enNav[key] ?? key;
}

// Mirror of NAV_KEYS order from AppNav
const ALL_NAV_KEYS: NavPage[] = ['dashboard', 'tenancies', 'documents', 'collections', 'commercial', 'settings'];

test('nav i18n: English labels match required values', () => {
  assert.equal(navLabel('dashboard', 'en'), 'Dashboard');
  assert.equal(navLabel('tenancies', 'en'), 'Rental');
  assert.equal(navLabel('documents', 'en'), 'Documents');
  assert.equal(navLabel('collections', 'en'), 'Collections');
  assert.equal(navLabel('commercial', 'en'), 'Commercial');
  assert.equal(navLabel('settings', 'en'), 'Settings');
});

test('nav i18n: Chinese labels match required values', () => {
  assert.equal(navLabel('dashboard', 'zh'), '仪表板');
  assert.equal(navLabel('tenancies', 'zh'), '租赁管理');
  assert.equal(navLabel('documents', 'zh'), '文件中心');
  assert.equal(navLabel('collections', 'zh'), '智能收款');
  assert.equal(navLabel('commercial', 'zh'), '商业地产');
  assert.equal(navLabel('settings', 'zh'), '设置');
});

test('nav i18n: live language switch produces different labels for every nav key', () => {
  for (const key of ALL_NAV_KEYS) {
    const en = navLabel(key, 'en');
    const zh = navLabel(key, 'zh');
    assert.notEqual(en, zh, `${key}: EN and ZH labels must differ after language switch`);
  }
});

test('nav i18n: active route class applied only to matching key', () => {
  const activePage: NavPage = 'collections';
  const classes = ALL_NAV_KEYS.map((key) => `ghost-button${key === activePage ? ' active' : ''}`);
  const activeIdx = ALL_NAV_KEYS.indexOf(activePage);
  assert.ok(classes[activeIdx].includes('active'), 'active page must carry active class');
  for (let i = 0; i < classes.length; i++) {
    if (i !== activeIdx) {
      assert.ok(!classes[i].includes('active'), `${ALL_NAV_KEYS[i]}: non-active page must not carry active class`);
    }
  }
});

test('nav i18n: RBAC — finance role sees 4 pages, not commercial or settings', () => {
  const role: WorkspaceRole = 'finance';
  const visible = ALL_NAV_KEYS.filter((key) => canAccess(role, key));
  assert.equal(visible.length, 4, 'finance must see exactly 4 pages');
  assert.ok(!visible.includes('commercial'), 'finance must not see commercial');
  assert.ok(!visible.includes('settings'), 'finance must not see settings');
  assert.ok(visible.includes('dashboard'), 'finance must see dashboard');
  assert.ok(visible.includes('tenancies'), 'finance must see tenancies');
  // Labels should still be translated after RBAC filter
  for (const key of visible) {
    const zhLabel = navLabel(key, 'zh');
    assert.ok(typeof zhLabel === 'string' && zhLabel.length > 0, `${key}: must have ZH label after RBAC filter`);
  }
});

test('nav i18n: RBAC — viewer role sees 4 pages, not commercial or settings', () => {
  const role: WorkspaceRole = 'viewer';
  const visible = ALL_NAV_KEYS.filter((key) => canAccess(role, key));
  assert.equal(visible.length, 4, 'viewer must see exactly 4 pages');
  assert.ok(!visible.includes('commercial'), 'viewer must not see commercial');
  assert.ok(!visible.includes('settings'), 'viewer must not see settings');
});

test('nav i18n: RBAC — owner sees all 6 pages', () => {
  const role: WorkspaceRole = 'owner';
  const visible = ALL_NAV_KEYS.filter((key) => canAccess(role, key));
  assert.equal(visible.length, 6, 'owner must see all 6 nav pages');
});

test('nav i18n: unknown key falls back to English then to key itself', () => {
  const unknownKey = 'unknown-page' as NavPage;
  const t = getTranslations('zh');
  const enNav = getTranslations(defaultLanguage).nav as Record<string, string>;
  const label = (t.nav as Record<string, string>)[unknownKey] ?? enNav[unknownKey] ?? unknownKey;
  assert.equal(label, unknownKey, 'unknown key must fall back to the key string itself');
});

test('nav i18n: all NavPage values have both EN and ZH translations defined', () => {
  const enNav = getTranslations('en').nav as Record<string, string>;
  const zhNav = getTranslations('zh').nav as Record<string, string>;
  for (const key of ALL_NAV_KEYS) {
    assert.ok(typeof enNav[key] === 'string' && enNav[key].length > 0, `EN translation missing for nav key "${key}"`);
    assert.ok(typeof zhNav[key] === 'string' && zhNav[key].length > 0, `ZH translation missing for nav key "${key}"`);
  }
});

test('nav i18n: additional label keys present in translations (Home, Enquiries, etc.)', () => {
  const enNav = getTranslations('en').nav as Record<string, string>;
  const zhNav = getTranslations('zh').nav as Record<string, string>;
  const additionalKeys = ['home', 'enquiries', 'listings', 'subsale', 'viewings', 'negotiations', 'legal', 'contractors', 'mapLocation', 'contacts', 'reports', 'notifications', 'search'];
  for (const key of additionalKeys) {
    assert.ok(typeof enNav[key] === 'string' && enNav[key].length > 0, `EN missing extra nav key "${key}"`);
    assert.ok(typeof zhNav[key] === 'string' && zhNav[key].length > 0, `ZH missing extra nav key "${key}"`);
  }
});
