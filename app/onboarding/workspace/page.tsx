'use client';

import { useRef, useState } from 'react';

const translations = {
  en: { title: 'Start your workspace', subtitle: 'Set up your organization. You will become its Owner.', name: 'Workspace name', business: 'Business type', country: 'Country', timezone: 'Timezone', currency: 'Currency', language: 'Preferred language', registration: 'Company registration number (optional)', contact: 'Contact number (optional)', submit: 'Create workspace', required: 'Complete all required fields.', failed: 'Workspace creation failed. Please try again.', toggle: '中文' },
  zh: { title: '创建您的工作区', subtitle: '设置您的组织。您将成为该工作区的所有者。', name: '工作区名称', business: '业务类型', country: '国家/地区', timezone: '时区', currency: '货币', language: '首选语言', registration: '公司注册号码（可选）', contact: '联系电话（可选）', submit: '创建工作区', required: '请填写所有必填项目。', failed: '无法创建工作区，请重试。', toggle: 'EN' }
};

export default function WorkspaceOnboardingPage() {
  const [locale, setLocale] = useState<'en' | 'zh'>('en');
  const [form, setForm] = useState({ workspaceName: '', businessType: 'property_management', country: 'MY', timezone: 'Asia/Kuala_Lumpur', preferredCurrency: 'MYR', preferredLanguage: 'en', companyRegistrationNumber: '', contactNumber: '' });
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const t = translations[locale];
  function update(key: keyof typeof form, value: string) { setForm((current) => ({ ...current, [key]: value })); }

  async function submit() {
    if (!form.workspaceName.trim() || !form.businessType || !form.country || !form.timezone || !form.preferredCurrency) return setNotice(t.required);
    if (busy) return;
    idempotencyKey.current ??= crypto.randomUUID();
    setBusy(true); setNotice('');
    const response = await fetch('/api/workspaces/provision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, idempotencyKey: idempotencyKey.current }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok || !result.success) return setNotice(t.failed);
    window.location.assign('/home');
  }

  return (
    <main className="auth-shell"><section className="auth-panel onboarding-panel">
      <button className="ghost-button auth-language" onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}>{t.toggle}</button>
      <p className="eyebrow">NEXORA / ONBOARDING</p><h1>{t.title}</h1><p>{t.subtitle}</p>
      <label className="field"><span>{t.name}</span><input value={form.workspaceName} onChange={(e) => update('workspaceName', e.target.value)} /></label>
      <label className="field"><span>{t.business}</span><select value={form.businessType} onChange={(e) => update('businessType', e.target.value)}><option value="property_management">Property management / 物业管理</option><option value="real_estate_agency">Real estate agency / 房地产代理</option><option value="commercial_real_estate">Commercial real estate / 商业地产</option><option value="other">Other / 其他</option></select></label>
      <label className="field"><span>{t.country}</span><input value={form.country} maxLength={2} onChange={(e) => update('country', e.target.value.toUpperCase())} /></label>
      <label className="field"><span>{t.timezone}</span><input value={form.timezone} onChange={(e) => update('timezone', e.target.value)} /></label>
      <label className="field"><span>{t.currency}</span><input value={form.preferredCurrency} maxLength={3} onChange={(e) => update('preferredCurrency', e.target.value.toUpperCase())} /></label>
      <label className="field"><span>{t.language}</span><select value={form.preferredLanguage} onChange={(e) => update('preferredLanguage', e.target.value)}><option value="en">English</option><option value="zh">中文</option><option value="ms">Bahasa Melayu</option></select></label>
      <label className="field"><span>{t.registration}</span><input value={form.companyRegistrationNumber} onChange={(e) => update('companyRegistrationNumber', e.target.value)} /></label>
      <label className="field"><span>{t.contact}</span><input value={form.contactNumber} onChange={(e) => update('contactNumber', e.target.value)} /></label>
      {notice && <div className="notice warning" role="alert">{notice}</div>}
      <button className="primary-button" disabled={busy} onClick={submit}>{busy ? '…' : t.submit}</button>
    </section></main>
  );
}
