'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ContactRound,
  FileText,
  FolderKanban,
  Gavel,
  Handshake,
  Home,
  Languages,
  MapPinned,
  Menu,
  Settings,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { WorkspaceRole, NavPage } from '../../lib/rbac/permissions';
import { ROLE_LABELS } from '../../lib/rbac/permissions';
import {
  HOME_NAV_ITEM,
  isPortalRouteActive,
  visiblePortalNavigation,
} from '../../lib/portal/navigation';
import NotificationBell from './NotificationBell';
import GlobalSearch from './GlobalSearch';
import { defaultLanguage, getTranslations, languageStorageKey, type Language } from '../../lib/i18n/translations';

type MePayload = {
  success: boolean;
  role?: WorkspaceRole;
};

type Props = {
  activePage?: NavPage;
  children?: React.ReactNode;
};

const ICONS: Record<NavPage, LucideIcon> = {
  home: Home,
  crm: Users,
  listings: Building2,
  deals: Handshake,
  viewings: CalendarDays,
  tenancies: FolderKanban,
  commercial: BriefcaseBusiness,
  collections: CircleDollarSign,
  documents: FileText,
  legal: Gavel,
  contractors: Wrench,
  mapLocation: MapPinned,
  aiCentre: Bot,
  dashboard: BarChart3,
  contacts: ContactRound,
  settings: Settings,
};

const collapsedStorageKey = 'nexora-sidebar-collapsed';

export default function AppNav({ activePage, children }: Props) {
  const pathname = usePathname();
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const [language, setLanguage] = useState<Language>(defaultLanguage);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(languageStorageKey);
    if (stored === 'en' || stored === 'zh') setLanguage(stored);
    setCollapsed(window.localStorage.getItem(collapsedStorageKey) === 'true');

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
      .then((response) => response.json())
      .then((payload: MePayload) => {
        if (payload.success && payload.role) setRole(payload.role);
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    firstLinkRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen]);

  const t = getTranslations(language);
  const en = getTranslations(defaultLanguage);
  const navCopy = t.nav as Record<string, string>;
  const enNavCopy = en.nav as Record<string, string>;
  const portalCopy = t.portal;
  const navigation = useMemo(() => role ? visiblePortalNavigation(role) : null, [role]);

  function label(key: string) {
    return navCopy[key] ?? enNavCopy[key] ?? key;
  }

  function changeLanguage() {
    const next = language === 'en' ? 'zh' : 'en';
    window.localStorage.setItem(languageStorageKey, next);
    window.dispatchEvent(new CustomEvent<Language>('nexora-language-change', { detail: next }));
    setLanguage(next);
  }

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    window.localStorage.setItem(collapsedStorageKey, String(next));
  }

  function onNavKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('a.portal-nav-link'));
    if (links.length === 0) return;
    const current = links.indexOf(document.activeElement as HTMLAnchorElement);
    let next = current;
    if (event.key === 'ArrowDown') next = current < links.length - 1 ? current + 1 : 0;
    if (event.key === 'ArrowUp') next = current > 0 ? current - 1 : links.length - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = links.length - 1;
    event.preventDefault();
    links[next]?.focus();
  }

  const activeKey = activePage;
  const isActive = (key: NavPage, href: string) => activeKey ? activeKey === key : isPortalRouteActive(pathname, href);
  const sidebarClass = `portal-sidebar${collapsed ? ' is-collapsed' : ''}${mobileOpen ? ' is-mobile-open' : ''}`;

  return (
    <>
      <div className="header-actions">
        <div className="app-nav-controls">
          <button
            type="button"
            className="portal-mobile-menu"
            onClick={() => setMobileOpen(true)}
            aria-label={portalCopy.navigation.open}
            aria-expanded={mobileOpen}
          >
            <Menu size={18} />
          </button>
          {children}
          <GlobalSearch />
          <NotificationBell />
          <button type="button" className="portal-language-button" onClick={changeLanguage} title={language === 'en' ? '简体中文' : 'English'}>
            <Languages size={17} />
            <span>{language === 'en' ? '中' : 'EN'}</span>
          </button>
          {role && (
            <span className="role-badge" title={`Your role: ${ROLE_LABELS[role]}`}>
              {ROLE_LABELS[role]}
            </span>
          )}
        </div>
      </div>

      {mobileOpen && <button type="button" className="portal-nav-backdrop" onClick={() => setMobileOpen(false)} aria-label={portalCopy.navigation.close} />}
      <aside className={sidebarClass} aria-label="Primary navigation" onKeyDown={onNavKeyDown}>
        <div className="portal-sidebar-brand">
          <a href="/home" className="portal-brand-link" aria-label="Nexora Home">
            <span className="portal-brand-mark">N</span>
            <span className="portal-brand-copy"><strong>Nexora</strong><small>Core</small></span>
          </a>
          <button type="button" className="portal-sidebar-close" onClick={() => setMobileOpen(false)} aria-label={portalCopy.navigation.close}>
            <X size={18} />
          </button>
        </div>

        <nav className="portal-nav-scroll">
          {navigation ? (
            <>
              {navigation.home && (
                <a
                  ref={firstLinkRef}
                  href={HOME_NAV_ITEM.href}
                  className={`portal-nav-link${isActive(HOME_NAV_ITEM.key, HOME_NAV_ITEM.href) ? ' active' : ''}`}
                  aria-current={isActive(HOME_NAV_ITEM.key, HOME_NAV_ITEM.href) ? 'page' : undefined}
                  title={collapsed ? label(HOME_NAV_ITEM.labelKey) : undefined}
                >
                  <Home size={18} />
                  <span>{label(HOME_NAV_ITEM.labelKey)}</span>
                </a>
              )}
              {navigation.groups.map((group) => (
                <section className="portal-nav-group" key={group.key}>
                  <h2>{portalCopy.groups[group.key]}</h2>
                  {group.items.map((item) => {
                    const Icon = ICONS[item.key];
                    const active = isActive(item.key, item.href);
                    return (
                      <a
                        key={item.key}
                        href={item.href}
                        className={`portal-nav-link${active ? ' active' : ''}`}
                        aria-current={active ? 'page' : undefined}
                        title={collapsed ? label(item.labelKey) : undefined}
                      >
                        <Icon size={18} />
                        <span>{label(item.labelKey)}</span>
                      </a>
                    );
                  })}
                </section>
              ))}
            </>
          ) : (
            <div className="portal-nav-loading" aria-label="Loading navigation">
              {Array.from({ length: 8 }).map((_, index) => <span key={index} />)}
            </div>
          )}
        </nav>

        <button type="button" className="portal-collapse-button" onClick={toggleCollapsed} aria-label={collapsed ? portalCopy.navigation.expand : portalCopy.navigation.collapse}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          <span>{portalCopy.navigation.collapse}</span>
        </button>
      </aside>
    </>
  );
}
