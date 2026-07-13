'use client';

import { useEffect, useState } from 'react';

type Status = 'Passed' | 'Warning' | 'Failed' | 'Not configured';

type SystemCheckPayload = {
  auth?: Status;
  workspace?: Status;
  environment?: Record<string, Status>;
  check?: {
    tables?: Record<string, boolean>;
    workspaceColumns?: Record<string, boolean>;
    rls?: Record<string, boolean>;
    migration?: { applied?: boolean };
    legacyTables?: Record<string, Record<string, Status>>;
  };
  error?: string;
};

const copy = {
  en: {
    title: 'System Check',
    subtitle: 'Private beta deployment diagnostics.',
    loading: 'Checking...',
    failed: 'Failed',
    language: '中文',
    labels: {
      auth: 'Authentication',
      workspace: 'Workspace',
      environment: 'Environment',
      tables: 'Required tables',
      columns: 'Workspace ownership',
      rls: 'Row-level security',
      migration: 'Migration',
      properties: 'Legacy properties',
      listingMemory: 'Legacy listing memory'
    }
  },
  zh: {
    title: '系统检查',
    subtitle: '私测部署诊断。',
    loading: '检查中...',
    failed: '失败',
    language: 'EN',
    labels: {
      auth: '身份验证',
      workspace: '工作区',
      environment: '环境变量',
      tables: '必需数据表',
      columns: '工作区归属',
      rls: '行级安全',
      migration: '数据库迁移',
      properties: '旧版房产数据',
      listingMemory: '旧版房源记忆'
    }
  }
};

export default function SystemCheckPage() {
  const [language, setLanguage] = useState<'en' | 'zh'>('en');
  const [data, setData] = useState<SystemCheckPayload | null>(null);
  const [error, setError] = useState('');
  const t = copy[language];

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch('/api/admin/system-check', { cache: 'no-store' });
        const payload = await response.json() as SystemCheckPayload;
        if (!response.ok) throw new Error(payload.error || t.failed);
        setData(payload);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : t.failed);
      }
    }
    void load();
  }, [t.failed]);

  const rows = data ? buildRows(data, t.labels) : [];

  return (
    <main className="command-shell">
      <header className="command-header">
        <div><p className="eyebrow">NEXORA / ADMIN</p><h1>{t.title}</h1><p className="header-copy">{t.subtitle}</p></div>
        <button className="ghost-button" onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}>{t.language}</button>
      </header>
      <section className="panel bottom-grid">
        {!data && !error && <div className="empty-state"><h3>{t.loading}</h3></div>}
        {error && <div className="notice error">{error}</div>}
        {data && (
          <div className="system-check-list">
            {rows.map((row) => (
              <div className="system-check-row" key={row.label}>
                <span>{row.label}</span>
                <strong className={`system-status ${row.status.toLowerCase().replace(' ', '-')}`}>{row.status}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function buildRows(payload: SystemCheckPayload, labels: typeof copy.en.labels) {
  const check = payload.check;
  const legacy = check?.legacyTables;
  return [
    { label: labels.auth, status: payload.auth ?? 'Failed' },
    { label: labels.workspace, status: payload.workspace ?? 'Failed' },
    { label: labels.environment, status: aggregateStatuses(Object.values(payload.environment ?? {})) },
    { label: labels.tables, status: aggregateBooleans(check?.tables) },
    { label: labels.columns, status: aggregateBooleans(check?.workspaceColumns) },
    { label: labels.rls, status: aggregateBooleans(check?.rls) },
    { label: labels.migration, status: check?.migration?.applied ? 'Passed' : 'Failed' },
    { label: labels.properties, status: aggregateStatuses(Object.values(legacy?.properties ?? {})) },
    { label: labels.listingMemory, status: aggregateStatuses(Object.values(legacy?.listingMemory ?? {})) }
  ] satisfies Array<{ label: string; status: Status }>;
}

function aggregateBooleans(values?: Record<string, boolean>): Status {
  if (!values || Object.keys(values).length === 0) return 'Not configured';
  return Object.values(values).every(Boolean) ? 'Passed' : 'Failed';
}

function aggregateStatuses(values: Status[]): Status {
  if (values.length === 0) return 'Not configured';
  if (values.includes('Failed')) return 'Failed';
  if (values.includes('Warning')) return 'Warning';
  if (values.includes('Not configured')) return 'Not configured';
  return 'Passed';
}
