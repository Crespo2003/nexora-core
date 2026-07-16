'use client';

import { useMemo, useState } from 'react';
import { getSafeNextPath } from '../../lib/auth/navigation';
import { getBrowserSupabaseClient } from '../../lib/supabase/browser';

const copy = {
  en: {
    title: 'Create your Nexora account', subtitle: 'Verify your email, then start your workspace.',
    fullName: 'Full name', email: 'Email', password: 'Password', confirm: 'Confirm password',
    language: 'Preferred language', terms: 'I accept the Terms of Service and Privacy Policy.',
    submit: 'Create account', login: 'Already registered? Sign in', toggle: '中文',
    required: 'Complete all required fields.', mismatch: 'Passwords do not match.',
    weak: 'Use at least 10 characters for your password.', accept: 'You must accept the terms.',
    checkEmail: 'Check your email to verify your account. You can safely sign in if this email is already registered.',
    failed: 'Unable to create the account. Please review the details and try again.'
  },
  zh: {
    title: '创建您的 Nexora 账户', subtitle: '验证电子邮件后，即可创建工作区。',
    fullName: '姓名', email: '电子邮件', password: '密码', confirm: '确认密码',
    language: '首选语言', terms: '我接受服务条款和隐私政策。',
    submit: '创建账户', login: '已有账户？登录', toggle: 'EN',
    required: '请填写所有必填项目。', mismatch: '两次输入的密码不一致。',
    weak: '密码必须至少包含 10 个字符。', accept: '您必须接受条款。',
    checkEmail: '请检查电子邮件并验证账户。如果该邮箱已注册，您可以直接登录。',
    failed: '无法创建账户。请检查资料后重试。'
  }
};

export default function SignupPage() {
  const [locale, setLocale] = useState<'en' | 'zh'>('en');
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirm: '', preferredLanguage: 'en', terms: false });
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const supabase = useMemo(getBrowserSupabaseClient, []);
  const t = copy[locale];

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function signUp() {
    setNotice('');
    if (!form.fullName.trim() || !form.email.trim() || !form.password || !form.confirm) return setNotice(t.required);
    if (form.password.length < 10) return setNotice(t.weak);
    if (form.password !== form.confirm) return setNotice(t.mismatch);
    if (!form.terms) return setNotice(t.accept);
    if (!supabase) return setNotice(t.failed);

    setBusy(true);
    const next = getSafeNextPath(new URLSearchParams(window.location.search).get('next'));
    const callback = new URL('/auth/callback', window.location.origin);
    callback.searchParams.set('next', next);
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(), password: form.password,
      options: { emailRedirectTo: callback.toString(), data: { full_name: form.fullName.trim(), preferred_language: form.preferredLanguage } }
    });
    setBusy(false);
    if (error) return setNotice(error.status === 422 ? t.checkEmail : t.failed);
    if (data.session) window.location.assign('/onboarding/workspace');
    else setNotice(t.checkEmail);
  }

  return (
    <main className="auth-shell"><section className="auth-panel">
      <button className="ghost-button auth-language" onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}>{t.toggle}</button>
      <p className="eyebrow">NEXORA / SAAS</p><h1>{t.title}</h1><p>{t.subtitle}</p>
      <label className="field"><span>{t.fullName}</span><input autoComplete="name" value={form.fullName} onChange={(e) => update('fullName', e.target.value)} /></label>
      <label className="field"><span>{t.email}</span><input type="email" autoComplete="email" value={form.email} onChange={(e) => update('email', e.target.value)} /></label>
      <label className="field"><span>{t.password}</span><input type="password" autoComplete="new-password" value={form.password} onChange={(e) => update('password', e.target.value)} /></label>
      <label className="field"><span>{t.confirm}</span><input type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => update('confirm', e.target.value)} /></label>
      <label className="field"><span>{t.language}</span><select value={form.preferredLanguage} onChange={(e) => update('preferredLanguage', e.target.value)}><option value="en">English</option><option value="zh">中文</option><option value="ms">Bahasa Melayu</option></select></label>
      <label className="field checkbox-field"><input type="checkbox" checked={form.terms} onChange={(e) => update('terms', e.target.checked)} /><span>{t.terms}</span></label>
      {notice && <div className="notice info" role="status">{notice}</div>}
      <button className="primary-button" disabled={busy} onClick={signUp}>{busy ? '…' : t.submit}</button>
      <a className="text-link" href="/login">{t.login}</a>
    </section></main>
  );
}
