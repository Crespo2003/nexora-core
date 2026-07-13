'use client';

import { useEffect, useMemo, useState } from 'react';
import { getBrowserSupabaseClient } from '../../lib/supabase/browser';

const copy = {
  en: {
    title: 'First Admin Setup',
    subtitle: 'Create the first Nexora workspace and administrator.',
    closed: 'Setup is already completed.',
    signIn: 'Please sign in before setup.',
    workspace: 'Workspace name',
    fullName: 'Full name',
    phone: 'Phone',
    create: 'Create workspace',
    success: 'Workspace created. Redirecting...',
    failed: 'Setup failed.',
    login: 'Go to login',
    loading: 'Checking setup status...',
    language: '中文'
  },
  zh: {
    title: '第一位管理员设置',
    subtitle: '创建第一个 Nexora 工作区和管理员。',
    closed: '设置已经完成。',
    signIn: '请先登录再继续设置。',
    workspace: '工作区名称',
    fullName: '姓名',
    phone: '电话',
    create: '创建工作区',
    success: '工作区已创建，正在跳转...',
    failed: '设置失败。',
    login: '前往登录',
    loading: '正在检查设置状态...',
    language: 'EN'
  }
};

export default function SetupPage() {
  const [language, setLanguage] = useState<'en' | 'zh'>('en');
  const [status, setStatus] = useState<'loading' | 'open' | 'closed' | 'signed-out'>('loading');
  const [workspaceName, setWorkspaceName] = useState('Nexora Workspace');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const supabase = useMemo(getBrowserSupabaseClient, []);
  const t = copy[language];

  useEffect(() => {
    async function check() {
      const session = await supabase?.auth.getSession();
      if (!session?.data.session) {
        setStatus('signed-out');
        return;
      }
      const response = await fetch('/api/setup/status');
      const payload = await response.json();
      setStatus(payload.setupOpen ? 'open' : 'closed');
    }
    void check();
  }, [supabase]);

  async function completeSetup() {
    setBusy(true);
    const response = await fetch('/api/setup/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceName, fullName, phone, preferredLanguage: language })
    });
    const payload = await response.json();
    setBusy(false);
    if (!response.ok || !payload.success) return setNotice(t.failed);
    setNotice(t.success);
    window.setTimeout(() => { window.location.href = '/'; }, 600);
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <button className="ghost-button auth-language" onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}>{t.language}</button>
        <p className="eyebrow">NEXORA / PRIVATE BETA</p>
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>
        {status === 'loading' && <div className="notice info">{t.loading}</div>}
        {status === 'signed-out' && <><div className="notice warning">{t.signIn}</div><a className="primary-button" href="/login">{t.login}</a></>}
        {status === 'closed' && <><div className="notice warning">{t.closed}</div><a className="primary-button" href="/">{t.login}</a></>}
        {status === 'open' && (
          <>
            <label className="field"><span>{t.workspace}</span><input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} /></label>
            <label className="field"><span>{t.fullName}</span><input value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
            <label className="field"><span>{t.phone}</span><input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            {notice && <div className="notice warning">{notice}</div>}
            <button className="primary-button" disabled={busy || !workspaceName || !fullName} onClick={completeSetup}>{busy ? '...' : t.create}</button>
          </>
        )}
      </section>
    </main>
  );
}
