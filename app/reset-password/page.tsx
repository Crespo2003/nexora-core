'use client';

import { useMemo, useState } from 'react';
import { getBrowserSupabaseClient } from '../../lib/supabase/browser';

export default function ResetPasswordPage() {
  const [language, setLanguage] = useState<'en' | 'zh'>('en');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const supabase = useMemo(getBrowserSupabaseClient, []);
  const zh = language === 'zh';

  async function updatePassword() {
    if (!supabase) return setNotice('Supabase is not configured.');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setNotice(zh ? '无法更新密码。' : 'Unable to update password.');
    setNotice(zh ? '密码已更新。' : 'Password updated.');
    window.setTimeout(() => { window.location.href = '/login'; }, 800);
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <button className="ghost-button auth-language" onClick={() => setLanguage(zh ? 'en' : 'zh')}>{zh ? 'EN' : '中文'}</button>
        <p className="eyebrow">NEXORA</p>
        <h1>{zh ? '设置新密码' : 'Set new password'}</h1>
        <label className="field"><span>{zh ? '新密码' : 'New password'}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {notice && <div className="notice warning">{notice}</div>}
        <button className="primary-button" disabled={busy} onClick={updatePassword}>{busy ? '...' : (zh ? '更新密码' : 'Update password')}</button>
      </section>
    </main>
  );
}
