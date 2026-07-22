'use client';

import { useEffect, useState } from 'react';

type WorkspaceSettings = {
  id: string;
  name: string;
  slug: string;
  status: string;
  logo_url: string | null;
  ren_number: string;
  email_from_name: string;
  email_from_address: string;
  whatsapp_default_number: string;
  created_at: string;
};

type Tab = 'company' | 'notifications' | 'openai' | 'status';

const TABS: { key: Tab; label: string }[] = [
  { key: 'company', label: 'Company Profile' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'openai', label: 'OpenAI' },
  { key: 'status', label: 'Supabase Status' },
];

export default function SettingsWorkspace() {
  const [ws, setWs] = useState<WorkspaceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('company');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; msg: string } | null>(null);

  const [form, setForm] = useState({
    name: '',
    ren_number: '',
    email_from_name: '',
    email_from_address: '',
    whatsapp_default_number: '',
  });

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((payload: { success: boolean; workspace?: WorkspaceSettings }) => {
        if (payload.success && payload.workspace) {
          const w = payload.workspace;
          setWs(w);
          setForm({
            name: w.name ?? '',
            ren_number: w.ren_number ?? '',
            email_from_name: w.email_from_name ?? '',
            email_from_address: w.email_from_address ?? '',
            whatsapp_default_number: w.whatsapp_default_number ?? '',
          });
        }
      })
      .catch(() => setNotice({ tone: 'error', msg: 'Could not load settings.' }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await res.json() as { success: boolean; error?: string };
      if (payload.success) {
        setNotice({ tone: 'success', msg: 'Settings saved.' });
      } else {
        setNotice({ tone: 'error', msg: payload.error ?? 'Save failed.' });
      }
    } catch {
      setNotice({ tone: 'error', msg: 'Network error.' });
    } finally {
      setSaving(false);
    }
  }

  function field(label: string, key: keyof typeof form, type = 'text', placeholder = '') {
    return (
      <label className="settings-field">
        <span>{label}</span>
        <input
          type={type}
          value={form[key]}
          placeholder={placeholder}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        />
      </label>
    );
  }

  return (
    <main className="command-shell">
      <header className="command-header">
        <div>
          <p className="eyebrow">Nexora · Sprint 004</p>
          <h1>Settings</h1>
          <p className="header-copy">Manage your workspace profile, integrations, and system configuration.</p>
        </div>
        <div className="header-actions">
          <nav className="top-nav" aria-label="Primary">
            <a className="ghost-button" href="/dashboard">Dashboard</a>
            <a className="ghost-button" href="/">Rental Command Centre</a>
            <a className="ghost-button" href="/documents">Documents</a>
            <a className="ghost-button" href="/collections">Collections</a>
            <a className="ghost-button" href="/commercial">Commercial CRM</a>
            <a className="ghost-button active" href="/settings">Settings</a>
          </nav>
        </div>
      </header>

      {notice && <div className={`notice ${notice.tone}`} role="status">{notice.msg}</div>}

      <div className="settings-shell">
        <nav className="settings-tabs" aria-label="Settings sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={`settings-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="settings-body">
          {loading ? (
            <div className="notice info">Loading settings…</div>
          ) : tab === 'company' ? (
            <section className="settings-section">
              <h2>Company Profile</h2>
              <p className="header-copy">Basic information shown across Nexora and on generated documents.</p>
              {field('Workspace Name', 'name', 'text', 'e.g. Nexora Realty')}
              {field('REN Number', 'ren_number', 'text', 'e.g. E-12345')}
              <div className="settings-sub-heading">Email</div>
              {field('From Name', 'email_from_name', 'text', 'e.g. Nexora Realty')}
              {field('From Address', 'email_from_address', 'email', 'e.g. no-reply@nexora.com')}
              <div className="settings-sub-heading">WhatsApp</div>
              {field('Default Number', 'whatsapp_default_number', 'tel', 'e.g. +601112345678')}
              <div className="settings-actions">
                <button className="primary-button" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </section>
          ) : tab === 'notifications' ? (
            <section className="settings-section">
              <h2>Notification Settings</h2>
              <p className="header-copy">Configure when and how Nexora sends alerts for renewals, overdue rent, and CRM activity.</p>
              <div className="notice info">Notification preferences will be configurable in a future release. Nexora currently auto-generates alerts for tenancies expiring within 60 days, overdue collections, and recent document uploads.</div>
            </section>
          ) : tab === 'openai' ? (
            <section className="settings-section">
              <h2>OpenAI Settings</h2>
              <p className="header-copy">Nexora uses OpenAI to extract tenancy details from uploaded agreements.</p>
              <div className="settings-info-row">
                <span className="settings-info-label">Model</span>
                <span className="settings-info-value">gpt-4o</span>
              </div>
              <div className="settings-info-row">
                <span className="settings-info-label">API Key</span>
                <span className="settings-info-value">Configured via environment variable</span>
              </div>
              <div className="notice info">To update the OpenAI API key, set the <code>OPENAI_API_KEY</code> environment variable in your deployment environment and redeploy.</div>
            </section>
          ) : (
            <section className="settings-section">
              <h2>Supabase Status</h2>
              <p className="header-copy">Connection health for your workspace database.</p>
              {ws ? (
                <>
                  <div className="settings-info-row">
                    <span className="settings-info-label">Workspace ID</span>
                    <code className="settings-info-value settings-code">{ws.id}</code>
                  </div>
                  <div className="settings-info-row">
                    <span className="settings-info-label">Slug</span>
                    <span className="settings-info-value">{ws.slug}</span>
                  </div>
                  <div className="settings-info-row">
                    <span className="settings-info-label">Status</span>
                    <span className={`status-pill ${ws.status}`}>{ws.status}</span>
                  </div>
                  <div className="settings-info-row">
                    <span className="settings-info-label">Created</span>
                    <span className="settings-info-value">{ws.created_at?.slice(0, 10)}</span>
                  </div>
                  <div className="notice success" style={{ marginTop: 16 }}>Supabase connection is active.</div>
                </>
              ) : (
                <div className="notice error">Could not retrieve workspace details.</div>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
