import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhone } from '../lib/contacts/phone';
import { buildWhatsAppLink, isValidWhatsAppNumber } from '../lib/whatsapp/linkBuilder';
import { renderWhatsAppTemplate, whatsappTemplateTypes } from '../lib/whatsapp/messageTemplates';
import { recommendCollectionContacts, witnessWarning } from '../lib/whatsapp/contactRouting';
import { ManualWhatsAppProvider } from '../lib/whatsapp/provider';
import { buildWhatsAppCommunicationRecord, hashMessageContent } from '../lib/whatsapp/communicationHistory';

test('normalizes Malaysian numbers into WhatsApp international format', () => {
  assert.equal(normalizePhone('012-3456789').whatsappNumber, '60123456789');
  assert.equal(normalizePhone('+60 12-3456789').whatsappNumber, '60123456789');
  assert.equal(normalizePhone('60123456789').whatsappNumber, '60123456789');
});

test('preserves valid foreign numbers instead of discarding them', () => {
  const foreign = normalizePhone('+65 6123 4567');
  assert.equal(foreign.whatsappNumber, '6561234567');
  assert.equal(foreign.confidence, 'review');
});

test('does not mistake identifiers, dates, or currency for phone numbers', () => {
  assert.equal(normalizePhone('750514-14-5544').whatsappNumber, '');
  assert.equal(normalizePhone('18/07/2026').whatsappNumber, '');
  assert.equal(normalizePhone('RM 12,500').whatsappNumber, '');
});

test('rejects invalid WhatsApp numbers before a link is built', () => {
  assert.equal(isValidWhatsAppNumber('123'), false);
  assert.equal(isValidWhatsAppNumber('11111111'), false);
  assert.equal(isValidWhatsAppNumber('60123456789'), true);
});

test('builds a URL-encoded wa.me click-to-chat link and rejects invalid input', () => {
  const result = buildWhatsAppLink('60123456789', 'Hello there, rent is due & payable soon');
  assert.equal(result.error, null);
  assert.equal(result.url, 'https://wa.me/60123456789?text=Hello%20there%2C%20rent%20is%20due%20%26%20payable%20soon');

  assert.equal(buildWhatsAppLink('123', 'hi').error, 'invalid-whatsapp-number');
  assert.equal(buildWhatsAppLink('60123456789', '   ').error, 'empty-message');
});

test('strips separators before constructing the WhatsApp link', () => {
  const result = buildWhatsAppLink('+60 12-345 6789', 'Test');
  assert.equal(result.url, 'https://wa.me/60123456789?text=Test');
});

test('renders every template type without throwing and without empty placeholders', () => {
  for (const type of whatsappTemplateTypes) {
    const message = renderWhatsAppTemplate(type, 'en', { tenant_name: 'Ah Beng' });
    assert.equal(typeof message, 'string');
    assert.ok(message.length > 0);
    assert.equal(message.includes('undefined'), false);
    assert.equal(message.includes('null'), false);
  }
});

test('formats money as RM 12,500.00 and dates as DD/MM/YYYY inside messages', () => {
  const message = renderWhatsAppTemplate('rental_overdue', 'en', {
    tenant_name: 'Siti', amount_due: 2500, due_date: '2026-07-31'
  });
  assert.ok(message.includes('RM 2,500.00'));
  assert.ok(message.includes('31/07/2026'));
});

test('omits placeholder lines entirely when a variable is unknown, never showing a blank or zero', () => {
  const message = renderWhatsAppTemplate('rental_overdue', 'en', { tenant_name: 'Siti' });
  assert.equal(message.includes('Amount due'), false);
  assert.equal(message.includes('Due date'), false);
  assert.equal(message.includes('RM 0.00'), false);
});

test('renders an English template', () => {
  const message = renderWhatsAppTemplate('renewal_approaching', 'en', { tenant_name: 'Wei Ling', tenancy_expiry_date: '2026-09-01' });
  assert.ok(message.startsWith('Hi Wei Ling,'));
  assert.ok(message.includes('renewal date is approaching'));
});

test('renders a Chinese template', () => {
  const message = renderWhatsAppTemplate('renewal_approaching', 'zh', { tenant_name: '偉玲', tenancy_expiry_date: '2026-09-01' });
  assert.ok(message.startsWith('您好 偉玲，'));
  assert.ok(message.includes('续约日期即将到来'));
});

test('renders a bilingual template combining both languages', () => {
  const message = renderWhatsAppTemplate('general_follow_up', 'bilingual', { tenant_name: 'Wei Ling' });
  assert.ok(message.includes('Hi Wei Ling,'));
  assert.ok(message.includes('您好 Wei Ling，'));
  assert.ok(message.includes('---'));
});

test('recommends the primary tenant before agents, representatives, and manual picks', () => {
  const result = recommendCollectionContacts([
    { name: 'Confirmed Agent', role: 'tenant agent', represents: 'tenant', phone: '60111111111', isConfirmedTenantAgent: true },
    { name: 'Primary Tenant', role: 'tenant', represents: 'tenant', phone: '60122222222', isPrimaryTenant: true },
    { name: 'Manual Pick', role: 'other', represents: 'tenant', phone: '60133333333', isManuallySelectedCollectionContact: true, collectionAuthorized: true }
  ]);
  assert.equal(result.recommended?.name, 'Primary Tenant');
  assert.deepEqual(result.ranked.map((c) => c.name), ['Primary Tenant', 'Confirmed Agent', 'Manual Pick']);
});

test('never recommends a landlord, landlord agent, or unconfirmed witness for tenant collection', () => {
  const result = recommendCollectionContacts([
    { name: 'The Landlord', role: 'landlord', represents: 'landlord', phone: '60144444444' },
    { name: 'Landlord Agent', role: 'landlord_agent', represents: 'landlord', phone: '60155555555' },
    { name: 'Unconfirmed Witness', role: 'witness', represents: 'tenant', phone: '60166666666' }
  ]);
  assert.equal(result.recommended, null);
  assert.equal(result.excluded.length, 3);
});

test('surfaces a warning when the only usable contact is recorded as a witness', () => {
  const authorizedWitness = witnessWarning({ role: 'witness', represents: 'tenant', collectionAuthorized: true });
  assert.equal(authorizedWitness, null);
  const unauthorizedWitness = witnessWarning({ role: 'witness', represents: 'tenant' });
  assert.ok(unauthorizedWitness && unauthorizedWitness.length > 0);
});

test('excludes candidates without a usable phone number', () => {
  const result = recommendCollectionContacts([
    { name: 'No Phone Tenant', role: 'tenant', represents: 'tenant', phone: '', isPrimaryTenant: true }
  ]);
  assert.equal(result.recommended, null);
  assert.equal(result.excluded.length, 1);
});

test('the manual provider builds messages and returns a review-only link, never sending automatically', () => {
  const provider = new ManualWhatsAppProvider();
  const message = provider.buildMessage({ templateType: 'general_follow_up', language: 'en', variables: { tenant_name: 'Ah Beng' } });
  assert.ok(message.includes('Ah Beng'));
  const link = provider.openManualChat('60123456789', message);
  assert.ok(link.url?.startsWith('https://wa.me/60123456789'));
});

test('future Cloud API methods are reserved but not implemented in Phase 1', async () => {
  const provider = new ManualWhatsAppProvider();
  await assert.rejects(() => provider.sendTemplate!({}), /not-available/);
  await assert.rejects(() => provider.receiveWebhook!({}), /not-available/);
  await assert.rejects(() => provider.getMessageStatus!({}), /not-available/);
});

test('communication-history records never store the full message body by default', () => {
  const record = buildWhatsAppCommunicationRecord({
    workspaceId: 'workspace-1', tenancyId: 'tenancy-1', contactId: 'contact-1',
    templateType: 'rental_overdue', language: 'en', status: 'sent_manually',
    message: 'Hi Ah Beng, your rental of RM 2,500.00 is overdue.'
  });
  assert.equal(record.note, '');
  assert.equal(record.message_template, 'rental_overdue');
  assert.equal(record.content_hash.length > 0, true);
  assert.equal(record.workspace_id, 'workspace-1');
  assert.equal(record.contact_id, 'contact-1');
});

test('communication-history records only store the body when explicitly opted in', () => {
  const record = buildWhatsAppCommunicationRecord({
    workspaceId: 'workspace-1', contactId: 'contact-1', templateType: 'general_follow_up', language: 'en',
    status: 'replied', message: 'Tenant confirmed payment will be made Friday.', saveMessageBody: true
  });
  assert.equal(record.note, 'Tenant confirmed payment will be made Friday.');
});

test('content hash is deterministic and does not reveal the source text', () => {
  const first = hashMessageContent('Confidential tenancy message');
  const second = hashMessageContent('Confidential tenancy message');
  assert.equal(first, second);
  assert.equal(first.includes('Confidential'), false);
});
