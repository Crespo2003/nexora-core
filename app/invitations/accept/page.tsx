'use client';

import { useState } from 'react';

export default function AcceptInvitationPage() {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  async function accept() {
    const invitationCode = new URLSearchParams(window.location.search).get('invite');
    if (!invitationCode) return setNotice('This invitation link is invalid. / 此邀请链接无效。');
    setBusy(true);
    const response = await fetch('/api/workspace-invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: invitationCode }) });
    const result = await response.json();
    setBusy(false);
    if (response.status === 401) return window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    if (!response.ok) return setNotice(`${result.error ?? 'Invitation failed'} / 无法接受邀请`);
    window.location.assign('/');
  }
  return <main className="auth-shell"><section className="auth-panel"><p className="eyebrow">NEXORA / INVITATION</p><h1>Join workspace / 加入工作区</h1><p>Sign in with the same verified email address that received this invitation. / 请使用收到邀请的相同已验证邮箱登录。</p>{notice && <div className="notice warning">{notice}</div>}<button className="primary-button" disabled={busy} onClick={accept}>{busy ? '…' : 'Accept invitation / 接受邀请'}</button></section></main>;
}
