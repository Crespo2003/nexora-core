'use client';

import { useEffect, useState } from 'react';
import type { WorkspaceRole, NavPage } from '../../lib/rbac/permissions';
import { canAccess, ROLE_LABELS } from '../../lib/rbac/permissions';
import NotificationBell from './NotificationBell';
import GlobalSearch from './GlobalSearch';

type MePayload = {
  success: boolean;
  role?: WorkspaceRole;
};

const NAV_ITEMS: { key: NavPage; href: string; label: string }[] = [
  { key: 'dashboard',   href: '/dashboard',  label: 'Dashboard' },
  { key: 'tenancies',   href: '/',           label: 'Rental' },
  { key: 'documents',   href: '/documents',  label: 'Documents' },
  { key: 'collections', href: '/collections', label: 'Collections' },
  { key: 'commercial',  href: '/commercial', label: 'Commercial' },
  { key: 'settings',    href: '/settings',   label: 'Settings' },
];

type Props = {
  activePage: NavPage;
  children?: React.ReactNode;
};

export default function AppNav({ activePage, children }: Props) {
  const [role, setRole] = useState<WorkspaceRole | null>(null);

  useEffect(() => {
    fetch('/api/workspace/me')
      .then((r) => r.json())
      .then((p: MePayload) => {
        if (p.success && p.role) setRole(p.role);
      })
      .catch(() => null);
  }, []);

  const visibleItems = role === null
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => canAccess(role, item.key));

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
