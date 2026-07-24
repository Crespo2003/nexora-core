'use client';

import { useEffect, useState } from 'react';
import AppNav from '../components/AppNav';

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

type SettingsPayload = { success: boolean; workspace?: WorkspaceSettings };
type SavePayload = { success: boolean; error?: string };

type Tab = 'company' | 'notifications' | 'openai' | 'status';

const TABS: { key: Tab; label: string }[] = [
  { key: 'company',       label: 'Company Profile' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'openai',        label: 'OpenAI' },
  { key: 'status',        label: 'Supabase Status' },
];

type FormState = {
  name: string;
  ren_number: string;
  email_from_name: string;
  email_from_address: string;
  whatsapp_default_number: string;
};

export default function SettingsWorkspace() {
  const [ws, setWs] = useState<WorkspaceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('company');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; msg: string } | null>(null);

  const [form, setForm] = useState<FormState>({
    name: '',
    ren_number: '',
    email_from_name: '',
    email_from_address: '',
    whatsapp_default_number: '',
  });

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((payload: SettingsPayload) => {
        if (payload.success && payload.workspace) {
          const w = payload.workspace;
          setWs(w);
          setForm({
            name:                    w.name ?? '',
            ren_number:              w.ren_number ?? '',
            email_from_name:         w.email_from_name ?? '',
            email_from_address:      w.email_from_address ?? '',
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
      const payload = await res.json() as SavePayload;
      if (payload.success) {
        setNotice({ tone: 'success', msg: 'Settings saved successfully.' });
      } else {
        setNotice({ tone: 'error', msg: payload.error ?? 'Save failed. Please try again.' });
      }
    } catch {
      setNotice({ tone: 'error', msg: 'Network error. Please try again.' });
    } finally {
      setSaving(false);
    }
  }

  function Field({ label, name, type = 'text', placeholder = '' }: { label: string; name: keyof FormState; type?: string; placeholder?: string }) {
    return (
      <label className="settings-field">
        <span>{label}</span>
        <input
          type={type}
          value={form[name]}
          placeholder={placeholder}
          onChange={(e) => setForm((f) => ({ ...f, [name]: e.target.value }))}
        />
      </label>
    );
  }

  return (
    <main className="command-shell">
      <header className="command-header">
        <div>
          <p className="eyebrow">NEXORA · Sprint 004</p>
          <h1>Settings</h1>
          <p className="header-copy">Manage your workspace profile, integrations, and system configuration.</p>
        </div>
        <AppNav activePage="settings" />
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
            <div className="notice info">Loading workspace settings…</div>
          ) : tab === 'company' ? (
            <section className="settings-section">
              <h2>Company Profile</h2>
              <p className="header-copy" style={{ marginBottom: 20 }}>
                Basic details shown across Nexora and on generated documents.
              </p>
              <Field label="Workspace Name"  name="name"                   placeholder="e.g. Nexora Realty" />
              <Field label="REN Number"      name="ren_number"             placeholder="e.g. E-12345" />
              <div className="settings-sub-heading">Email</div>
              <Field label="From Name"       name="email_from_name"        placeholder="e.g. Nexora Realty" />
              <Field label="From Address"    name="email_from_address"     type="email" placeholder="e.g. no-reply@nexora.com" />
              <div className="settings-sub-heading">WhatsApp</div>
              <Field label="Default Number"  name="whatsapp_default_number" type="tel" placeholder="e.g. +601112345678" />
              <div className="settings-actions">
                <button className="primary-button" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </section>
          ) : tab === 'notifications' ? (
            <section className="settings-section">
              <h2>Notification Settings</h2>
              <p className="header-copy" style={{ marginBottom: 20 }}>
                Configure when Nexora sends alerts for renewals, overdue collections, and CRM activity.
              </p>
              <div className="notice info">
                Notification preferences are managed automatically. Nexora generates alerts for tenancies expiring within 60 days, overdue collections, and recent document uploads. Custom thresholds will be configurable in a future update.
              </div>
            </section>
          ) : tab === 'openai' ? (
            <section className="settings-section">
              <h2>OpenAI Configuration</h2>
              <p className="header-copy" style={{ marginBottom: 20 }}>
                Nexora uses OpenAI GPT-4o to extract tenancy details from uploaded agreements.
              </p>
              <div className="settings-info-row">
                <span className="settings-info-label">Model</span>
                <span className="settings-info-value">GPT-4o</span>
              </div>
              <div className="settings-info-row">
                <span className="settings-info-label">API Key</span>
                <span className="settings-info-value">Configured via environment variable</span>
              </div>
              <div className="settings-info-row">
                <span className="settings-info-label">Usage</span>
                <span className="settings-info-value">Tenancy agreement extraction only</span>
              </div>
              <div className="notice info" style={{ marginTop: 16 }}>
                To update the API key, set <code>OPENAI_API_KEY</code> in your deployment environment and redeploy.
              </div>
            </section>
          ) : (
            <section className="settings-section">
              <h2>Supabase Status</h2>
              <p className="header-copy" style={{ marginBottom: 20 }}>
                Connection health and workspace database details.
              </p>
              {ws ? (
                <>
                  <div className="settings-info-row">
                    <span className="settings-info-label">Workspace</span>
                    <span className="settings-info-value">{ws.name}</span>
                  </div>
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
                  <div className="notice success" style={{ marginTop: 16 }}>
                    Database connection is active and healthy.
                  </div>
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
