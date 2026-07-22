'use client';

import { useEffect, useState } from 'react';
import type { WorkspaceRole, NavPage } from '../../lib/rbac/permissions';
import { canAccess, ROLE_LABELS } from '../../lib/rbac/permissions';
import NotificationBell from './NotificationBell';
import GlobalSearch from './GlobalSearch';
import { defaultLanguage, getTranslations, languageStorageKey, type Language } from '../../lib/i18n/translations';

type MePayload = {
  success: boolean;
  role?: WorkspaceRole;
};

const NAV_KEYS: { key: NavPage; href: string }[] = [
  { key: 'dashboard',   href: '/dashboard' },
  { key: 'tenancies',   href: '/' },
  { key: 'documents',   href: '/documents' },
  { key: 'collections', href: '/collections' },
  { key: 'commercial',  href: '/commercial' },
  { key: 'settings',    href: '/settings' },
];

type Props = {
  activePage: NavPage;
  children?: React.ReactNode;
};

export default function AppNav({ activePage, children }: Props) {
  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const [language, setLanguage] = useState<Language>(defaultLanguage);

  useEffect(() => {
    const stored = window.localStorage.getItem(languageStorageKey);
    if (stored === 'en' || stored === 'zh') setLanguage(stored);

    function onStorage(e: StorageEvent) {
      if (e.key === languageStorageKey && (e.newValue === 'en' || e.newValue === 'zh')) {
        setLanguage(e.newValue);
      }
    }
    function onLanguageChange(e: Event) {
      const lang = (e as CustomEvent<Language>).detail;
      if (lang === 'en' || lang === 'zh') setLanguage(lang);
    }

    window.addEventListener('storage', onStorage);
    window.addEventListener('nexora-language-change', onLanguageChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('nexora-language-change', onLanguageChange);
    };
  }, []);

  useEffect(() => {
    fetch('/api/workspace/me')
      .then((r) => r.json())
      .then((p: MePayload) => {
        if (p.success && p.role) setRole(p.role);
      })
      .catch(() => null);
  }, []);

  const t = getTranslations(language);
  const enNav = getTranslations(defaultLanguage).nav as Record<string, string>;
  const navItems = NAV_KEYS.map((item) => ({
    ...item,
    label: (t.nav as Record<string, string>)[item.key] ?? enNav[item.key] ?? item.key,
  }));

  const visibleItems = role === null
    ? navItems
    : navItems.filter((item) => canAccess(role, item.key));

  return (
    <div className="header-actions">
      <div className="app-nav-controls">
        {children}
        <GlobalSearch />
        <NotificationBell />
        {role && (
          <span className="role-badge" title={`Your role: ${ROLE_LABELS[role]}`}>
            {ROLE_LABELS[role]}
          </span>
        )}
      </div>
      <nav className="top-nav" aria-label="Primary">
        {visibleItems.map((item) => (
          <a
            key={item.key}
            className={`ghost-button${activePage === item.key ? ' active' : ''}`}
            href={item.href}
          >
            {item.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
