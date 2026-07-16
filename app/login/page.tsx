'use client';

import { useMemo, useState } from 'react';
import { getBrowserSupabaseClient } from '../../lib/supabase/browser';

const copy = {
  en: { title: 'Sign in to Nexora', subtitle: 'Access your secure workspace.', email: 'Email', password: 'Password', signIn: 'Sign in', create: 'Create account', forgot: 'Forgot password?', error: 'Unable to sign in. Check your email verification and credentials.', toggle: '中文' },
  zh: { title: '登录 Nexora', subtitle: '进入您的安全工作区。', email: '电子邮件', password: '密码', signIn: '登录', create: '创建账户', forgot: '忘记密码？', error: '无法登录。请检查电子邮件验证状态和登录资料。', toggle: 'EN' }
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
    if (!supabase) return setNotice(t.error);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setNotice(t.error);
    const next = new URLSearchParams(window.location.search).get('next');
    window.location.assign(`/auth/route${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  }

  return (
    <main className="auth-shell"><section className="auth-panel">
      <button className="ghost-button auth-language" onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}>{t.toggle}</button>
      <p className="eyebrow">NEXORA</p><h1>{t.title}</h1><p>{t.subtitle}</p>
      <label className="field"><span>{t.email}</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="field"><span>{t.password}</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {notice && <div className="notice warning" role="alert">{notice}</div>}
      <button className="primary-button" disabled={busy} onClick={signIn}>{busy ? '…' : t.signIn}</button>
      <a className="secondary-button" href="/signup">{t.create}</a>
      <a className="text-link" href="/forgot-password">{t.forgot}</a>
    </section></main>
  );
}
