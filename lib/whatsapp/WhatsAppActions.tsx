'use client';

import { useMemo, useState } from 'react';
import { MessageCircle, Copy, Send, X } from 'lucide-react';
import { normalizePhone } from '../contacts/phone';
import { buildWhatsAppLink } from './linkBuilder';
import { renderWhatsAppTemplate, whatsappTemplateTypes, type WhatsAppLanguage, type WhatsAppTemplateType, type WhatsAppTemplateVariables } from './messageTemplates';
import { witnessWarning } from './contactRouting';
import { whatsappCommunicationStatuses, type WhatsAppCommunicationStatus } from './communicationHistory';

const templateLabels: Record<WhatsAppTemplateType, { en: string; zh: string }> = {
  rental_due_soon: { en: 'Rental due soon', zh: '租金即将到期' },
  rental_overdue: { en: 'Rental overdue', zh: '租金逾期' },
  partial_payment: { en: 'Partial payment', zh: '部分付款' },
  utility_outstanding: { en: 'Utility outstanding', zh: '水电未结' },
  payment_promised: { en: 'Payment promised', zh: '承诺付款' },
  payment_confirmation: { en: 'Payment confirmation', zh: '付款确认' },
  receipt_issued: { en: 'Receipt issued', zh: '已开收据' },
  renewal_approaching: { en: 'Renewal approaching', zh: '续约临近' },
  notice_required: { en: 'Notice required', zh: '需发通知' },
  tenancy_expiry: { en: 'Tenancy expiry', zh: '租约到期' },
  general_follow_up: { en: 'General follow-up', zh: '一般跟进' }
};

const statusLabels: Record<WhatsAppCommunicationStatus, { en: string; zh: string }> = {
  prepared: { en: 'Message prepared', zh: '信息已准备' },
  sent_manually: { en: 'Message sent manually', zh: '已手动发送' },
  no_answer: { en: 'No answer', zh: '无人接听' },
  replied: { en: 'Replied', zh: '已回复' },
  payment_promised: { en: 'Payment promised', zh: '承诺付款' },
  follow_up_required: { en: 'Follow-up required', zh: '需要跟进' },
  wrong_number: { en: 'Wrong number', zh: '号码错误' }
};

export type WhatsAppContactInfo = {
  contactId?: string;
  name: string;
  role: string;
  represents?: string;
  phone: string;
  collectionAuthorized?: boolean;
};

type Props = {
  contact: WhatsAppContactInfo;
  tenancyId?: string;
  defaultTemplateType?: WhatsAppTemplateType;
  variables: WhatsAppTemplateVariables;
  uiLanguage?: 'en' | 'zh';
};

export default function WhatsAppActions({ contact, tenancyId, defaultTemplateType = 'general_follow_up', variables, uiLanguage = 'en' }: Props) {
  const phone = useMemo(() => normalizePhone(contact.phone), [contact.phone]);
  const [open, setOpen] = useState(false);
  const [templateType, setTemplateType] = useState<WhatsAppTemplateType>(defaultTemplateType);
  const [language, setLanguage] = useState<WhatsAppLanguage>('en');
  const [message, setMessage] = useState('');
  const [edited, setEdited] = useState(false);
  const [stage, setStage] = useState<'compose' | 'outcome'>('compose');
  const [status, setStatus] = useState<WhatsAppCommunicationStatus>('sent_manually');
  const [followUpDate, setFollowUpDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  if (!phone.whatsappNumber) return null;
  const zh = uiLanguage === 'zh';
  const warning = witnessWarning({ role: contact.role, represents: contact.represents, collectionAuthorized: contact.collectionAuthorized });

  const currentMessage = edited ? message : renderWhatsAppTemplate(templateType, language, variables);

  function launch() {
    setTemplateType(defaultTemplateType);
    setLanguage('en');
    setEdited(false);
    setStage('compose');
    setFeedback('');
    setFollowUpDate('');
    setOpen(true);
  }

  async function copyNumber() {
    try { await navigator.clipboard.writeText(phone.display || phone.normalized); } catch { /* clipboard unavailable */ }
  }

  async function logCommunication(nextStatus: WhatsAppCommunicationStatus) {
    setBusy(true);
    try {
      const response = await fetch('/api/whatsapp/communications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenancyId, contactId: contact.contactId, contactName: contact.name, contactPhone: contact.phone,
          templateType, language, status: nextStatus, message: currentMessage, followUpDate: followUpDate || null
        })
      });
      if (!response.ok) throw new Error('log-failed');
      setFeedback(zh ? '已记录。' : 'Recorded.');
    } catch {
      setFeedback(zh ? '记录失败，请重试。' : 'Could not record this action.');
    } finally {
      setBusy(false);
    }
  }

  function confirmAndOpen() {
    const link = buildWhatsAppLink(phone.whatsappNumber, currentMessage);
    if (!link.url) { setFeedback(zh ? '号码或信息无效。' : 'The number or message is invalid.'); return; }
    window.open(link.url, '_blank', 'noreferrer');
    void logCommunication('sent_manually');
    setStage('outcome');
  }

  return (
    <span className="wa-actions">
      <button type="button" className="wa-icon-button" onClick={launch} aria-label={zh ? '打开 WhatsApp' : 'Open WhatsApp'} title={zh ? '打开 WhatsApp' : 'Open WhatsApp'}>
        <MessageCircle size={15} />
      </button>
      <button type="button" className="wa-icon-button" onClick={() => void copyNumber()} aria-label={zh ? '复制号码' : 'Copy WhatsApp number'} title={zh ? '复制号码' : 'Copy WhatsApp number'}>
        <Copy size={15} />
      </button>

      {open && (
        <div className="wa-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <div className="wa-modal" role="dialog" aria-modal="true" aria-label={zh ? 'WhatsApp 信息' : 'WhatsApp message'}>
            <header>
              <div>
                <p className="wa-eyebrow">{contact.name || (zh ? '联系人' : 'Contact')}</p>
                <h3>{phone.display || phone.normalized}</h3>
              </div>
              <button type="button" className="wa-icon-button" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
            </header>

            {warning && <p className="wa-warning">{zh ? '此联系人仅记录为见证人，请先确认授权。' : warning}</p>}

            {stage === 'compose' ? (
              <>
                <div className="wa-field-row">
                  <label>
                    <span>{zh ? '信息模板' : 'Template'}</span>
                    <select value={templateType} onChange={(event) => { setTemplateType(event.target.value as WhatsAppTemplateType); setEdited(false); }}>
                      {whatsappTemplateTypes.map((type) => <option key={type} value={type}>{zh ? templateLabels[type].zh : templateLabels[type].en}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>{zh ? '语言' : 'Language'}</span>
                    <select value={language} onChange={(event) => { setLanguage(event.target.value as WhatsAppLanguage); setEdited(false); }}>
                      <option value="en">English</option>
                      <option value="zh">中文</option>
                      <option value="bilingual">English + 中文</option>
                    </select>
                  </label>
                </div>
                <label className="wa-message">
                  <span>{zh ? '信息内容' : 'Message'}</span>
                  <textarea rows={10} value={currentMessage} onChange={(event) => { setMessage(event.target.value); setEdited(true); }} />
                </label>
                {feedback && <p className="wa-feedback">{feedback}</p>}
                <footer>
                  <button type="button" className="wa-secondary" onClick={() => setOpen(false)}>{zh ? '取消' : 'Cancel'}</button>
                  <button type="button" className="wa-primary" onClick={confirmAndOpen} disabled={busy}><Send size={15} /> {zh ? '确认并打开 WhatsApp' : 'Confirm and open WhatsApp'}</button>
                </footer>
              </>
            ) : (
              <>
                <p className="wa-eyebrow">{zh ? '记录本次沟通结果' : 'Record the outcome of this communication'}</p>
                <div className="wa-field-row">
                  <label>
                    <span>{zh ? '结果' : 'Outcome'}</span>
                    <select value={status} onChange={(event) => setStatus(event.target.value as WhatsAppCommunicationStatus)}>
                      {whatsappCommunicationStatuses.map((option) => <option key={option} value={option}>{zh ? statusLabels[option].zh : statusLabels[option].en}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>{zh ? '跟进日期' : 'Follow-up date'}</span>
                    <input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
                  </label>
                </div>
                {feedback && <p className="wa-feedback">{feedback}</p>}
                <footer>
                  <button type="button" className="wa-secondary" onClick={() => setOpen(false)}>{zh ? '完成' : 'Done'}</button>
                  <button type="button" className="wa-primary" onClick={() => void logCommunication(status)} disabled={busy}>{zh ? '保存结果' : 'Save outcome'}</button>
                </footer>
              </>
            )}
          </div>
        </div>
      )}
    </span>
  );
}
