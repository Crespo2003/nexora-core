'use client';

import { useEffect, useRef, useState } from 'react';

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string;
  title_zh?: string;
  body_zh?: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
};

function typeIcon(type: string): string {
  if (type === 'renewal') return '🔄';
  if (type === 'outstanding') return '💰';
  if (type === 'document_upload') return '📄';
  if (type === 'crm_reminder') return '📋';
  if (type === 'collection_reminder') return '📅';
  return '🔔';
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function NotificationBell() {
  const [language, setLanguage] = useState<'en' | 'zh'>('en');
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem('nexora-language');
    if (stored === 'zh') setLanguage('zh');
    function onLanguage(event: Event) {
      const next = (event as CustomEvent<'en' | 'zh'>).detail;
      if (next === 'en' || next === 'zh') setLanguage(next);
    }
    window.addEventListener('nexora-language-change', onLanguage);
    return () => window.removeEventListener('nexora-language-change', onLanguage);
  }, []);

  useEffect(() => {
    fetch('/api/notifications')
      .then((r) => r.json())
      .then((p: { success: boolean; notifications?: Notification[]; unreadCount?: number }) => {
        if (p.success) {
          setNotifications(p.notifications ?? []);
          setUnread(p.unreadCount ?? 0);
        }
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function markAllRead() {
    setUnread(0);
    fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => null);
  }

  return (
    <div className="notif-bell-wrap" ref={ref}>
      <button
        className="notif-bell-btn"
        aria-label={`Notifications${unread > 0 ? ` — ${unread} unread` : ''}`}
        onClick={() => { setOpen((o) => !o); if (!open && unread > 0) markAllRead(); }}
      >
        <span className="notif-bell-icon">🔔</span>
        {unread > 0 && <span className="notif-bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-dropdown" role="dialog" aria-label="Notifications">
          <div className="notif-dropdown-header">
            <strong>{language === 'zh' ? '通知' : 'Notifications'}</strong>
            {notifications.length > 0 && (
              <button className="notif-clear-btn" onClick={markAllRead}>{language === 'zh' ? '全部标为已读' : 'Mark all read'}</button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="notif-empty">{language === 'zh' ? '暂无通知。' : 'No notifications.'}</p>
          ) : (
            <ul className="notif-list">
              {notifications.slice(0, 20).map((n) => (
                <li key={n.id} className="notif-item">
                  <span className="notif-icon">{typeIcon(n.type)}</span>
                  <div className="notif-body">
                    <span className="notif-title">{language === 'zh' ? n.title_zh ?? n.title : n.title}</span>
                    {n.body && <span className="notif-sub">{language === 'zh' ? n.body_zh ?? n.body : n.body}</span>}
                  </div>
                  <span className="notif-time">{timeAgo(n.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
