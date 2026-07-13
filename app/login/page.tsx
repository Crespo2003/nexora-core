'use client';

import { useMemo, useState } from 'react';
import { getBrowserSupabaseClient } from '../../lib/supabase/browser';

const copy = {
  en: {
    title: 'Sign in to Nexora',
    subtitle: 'Private beta access for your real estate workspace.',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    createFirst: 'Create first admin',
    forgot: 'Forgot password?',
    success: 'Check your email to confirm the account, then return to setup.',
    error: 'Unable to sign in.',
    language: '中文'
  },
  zh: {
    title: '登录 Nexora',
    subtitle: '房地产工作区私测访问。',
    email: '电邮',
    password: '密码',
    signIn: '登录',
    createFirst: '创建第一位管理员',
    forgot: '忘记密码？',
    success: '请到邮箱确认账号，然后回到设置页面。',
    error: '无法登录。',
    language: 'EN'
  }
};

export default function LoginPage() {
  const [language, setLanguage] = useState<'en' | 'zh'>('en');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const supabase = useMemo(getBrowserSupabaseClient, []);
  const t = copy[language];

  async function signIn() {
    if (!supabase) return setNotice('Supabase is not configured.');
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setNotice(t.error);
    window.location.href = new URLSearchParams(window.location.search).get('next') || '/';
  }

  async function createFirstAdminAccount() {
    if (!supabase) return setNotice('Supabase is not configured.');
    setBusy(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) return setNotice(error.message);
    setNotice(t.success);
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <button className="ghost-button auth-language" onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}>{t.language}</button>
        <p className="eyebrow">NEXORA / PRIVATE BETA</p>
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>
        <label className="field"><span>{t.email}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="field"><span>{t.password}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {notice && <div className="notice warning">{notice}</div>}
        <button className="primary-button" disabled={busy} onClick={signIn}>{busy ? '...' : t.signIn}</button>
        <button className="secondary-button" disabled={busy} onClick={createFirstAdminAccount}>{t.createFirst}</button>
        <a className="text-link" href="/forgot-password">{t.forgot}</a>
      </section>
    </main>
  );
}
