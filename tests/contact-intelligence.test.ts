import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizePropertyAddress } from '../lib/contacts/address';
import { isConfirmedCollectionContact, normalizePhone } from '../lib/contacts/phone';
import { formatMYR, parseMYR } from '../lib/formatters';
import { normalizeIdentification } from '../lib/ai/tenancyExtractionContract';

test('formats Malaysian currency only when an amount is confirmed', () => {
  assert.equal(formatMYR(12500), 'RM 12,500.00');
  assert.equal(formatMYR(-12.5), 'RM -12.50');
  assert.equal(formatMYR(0), 'RM 0.00');
  assert.equal(formatMYR(null), '');
  assert.equal(parseMYR('RM12,500'), 12500);
  assert.equal(parseMYR('12,500 MYR'), 12500);
  assert.equal(parseMYR('RM 12,500.00'), 12500);
  assert.equal(parseMYR('not an amount'), null);
});

test('normalizes Malaysian numbers and preserves foreign numbers for review', () => {
  const mobile = normalizePhone('012-3456789');
  assert.equal(mobile.normalized, '+60123456789');
  assert.equal(mobile.whatsappNumber, '60123456789');
  assert.equal(mobile.confidence, 'high');
  assert.equal(normalizePhone('03-1234 5678').normalized, '+60312345678');
  const foreign = normalizePhone('+65 6123 4567');
  assert.equal(foreign.normalized, '+6561234567');
  assert.equal(foreign.confidence, 'review');
  assert.equal(normalizePhone('RM 12,500').normalized, '');
  assert.equal(normalizePhone('18/07/2026').normalized, '');
});

test('does not treat a witness as a collection contact without authority', () => {
  assert.equal(isConfirmedCollectionContact({ role: 'witness', represents: 'tenant' }), false);
  assert.equal(isConfirmedCollectionContact({ role: 'tenant agent', represents: 'tenant' }), true);
  assert.equal(isConfirmedCollectionContact({ role: 'witness', represents: 'tenant', collectionAuthorized: true }), true);
});

test('normalizes Malaysian property addresses without replacing the source text', () => {
  const address = normalizePropertyAddress('  Unit 12-3,  Jalan Tun Razak,  50400 Kuala Lumpur, Malaysia  ');
  assert.equal(address.fullAddress, 'Unit 12-3, Jalan Tun Razak, 50400 Kuala Lumpur, Malaysia');
  assert.equal(address.postcode, '50400');
  assert.equal(address.state, 'Kuala Lumpur');
  assert.equal(address.country, 'Malaysia');
  assert.equal(address.originalAddress.includes('  '), true);
});

test('removes identity labels without changing the identification value', () => {
  assert.equal(normalizeIdentification('NRICNo:750514-14-5544'), '750514-14-5544');
  assert.equal(normalizeIdentification('Passport No: A1234567'), 'A1234567');
  assert.equal(normalizeIdentification('Company No: 202001234567'), '202001234567');
});

test('contact migration is workspace-scoped and RLS-protected', () => {
  const sql = readFileSync('supabase/migrations/20260717193513_contact_management_and_collection_routing.sql', 'utf8');
  for (const table of ['contacts', 'contact_roles', 'tenancy_contacts', 'contact_channels', 'contact_follow_ups', 'contact_communications', 'collection_contact_preferences', 'duplicate_decisions', 'contact_audit_history']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /has_workspace_role\(workspace_id/);
});
