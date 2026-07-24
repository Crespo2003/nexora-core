'use client';

import { useEffect, useState } from 'react';
import AppNav from './AppNav';
import { usePortalLanguage } from './usePortalLanguage';
import { getTranslations } from '../../lib/i18n/translations';
import type { NavPage } from '../../lib/rbac/permissions';

export default function PortalPlaceholder({ page, labelKey }: { page: NavPage; labelKey: string }) {
  const language = usePortalLanguage();
  const [hasAction, setHasAction] = useState(false);
  const t = getTranslations(language);
  const nav = t.nav as Record<string, string>;
  const title = nav[labelKey] ?? labelKey;

  useEffect(() => {
    setHasAction(new URLSearchParams(window.location.search).has('action'));
  }, []);

  return (
    <main className="command-shell portal-placeholder-page">
      <header className="command-header">
        <div>
          <p className="eyebrow">{t.portal.placeholder.eyebrow}</p>
          <h1>{title}</h1>
          <p className="header-copy">{t.portal.descriptions[page as keyof typeof t.portal.descriptions]}</p>
        </div>
        <AppNav activePage={page} />
      </header>
      <section className="panel portal-placeholder-card">
        <span className="portal-placeholder-mark" aria-hidden="true">{title.slice(0, 1)}</span>
        <h2>{title} {t.portal.placeholder.titleSuffix}</h2>
        <p>{t.portal.placeholder.body}</p>
        {hasAction && <p className="portal-placeholder-action">{t.portal.placeholder.actionHint}</p>}
        <a className="primary-button portal-inline-button" href="/home">{t.portal.placeholder.backHome}</a>
      </section>
    </main>
  );
}
