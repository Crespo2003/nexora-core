'use client';

import { useMemo, useState } from 'react';
import { getBrowserSupabaseClient } from '../../lib/supabase/browser';

export default function ForgotPasswordPage() {
  const [language, setLanguage] = useState<'en' | 'zh'>('en');
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const supabase = useMemo(getBrowserSupabaseClient, []);
  const zh = language === 'zh';

  async function sendReset() {
    if (!supabase) return setNotice('Supabase is not configured.');
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    setNotice(error ? (zh ? '无法发送重设链接。' : 'Unable to send reset link.') : (zh ? '重设链接已发送。' : 'Reset link sent.'));
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <button className="ghost-button auth-language" onClick={() => setLanguage(zh ? 'en' : 'zh')}>{zh ? 'EN' : '中文'}</button>
        <p className="eyebrow">NEXORA</p>
        <h1>{zh ? '重设密码' : 'Reset password'}</h1>
        <p>{zh ? '输入您的电邮以接收重设链接。' : 'Enter your email to receive a reset link.'}</p>
        <label className="field"><span>{zh ? '电邮' : 'Email'}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        {notice && <div className="notice warning">{notice}</div>}
        <button className="primary-button" disabled={busy} onClick={sendReset}>{busy ? '...' : (zh ? '发送链接' : 'Send link')}</button>
        <a className="text-link" href="/login">{zh ? '返回登录' : 'Back to login'}</a>
      </section>
    </main>
  );
}
