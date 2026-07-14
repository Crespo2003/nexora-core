import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/202607140330_sprint_005_final_blocker_remediation.sql', 'utf8');
const tenancyRoute = readFileSync('app/api/tenancies/[id]/route.ts', 'utf8');
const paymentRoute = readFileSync('app/api/collections/payments/route.ts', 'utf8');
const utilityRoute = readFileSync('app/api/utility-bills/confirm/route.ts', 'utf8');
const collectionRoute = readFileSync('app/api/collections/generate-monthly/route.ts', 'utf8');
const reminderRoute = readFileSync('app/api/collection-reminders/log/route.ts', 'utf8');
const followupRoute = readFileSync('app/api/collection-followups/action/route.ts', 'utf8');
const retryRoute = readFileSync('app/api/documents/[id]/retry/route.ts', 'utf8');

test('transaction RPCs use caller RLS and are unavailable to anonymous users', () => {
  for (const name of [
    'sprint_005_create_document_bundle',
    'sprint_005_save_extraction_review',
    'sprint_005_confirm_tenancy_extraction',
    'sprint_005_confirm_utility_bill',
    'sprint_005_record_collection_transaction',
    'sprint_005_upsert_utility_account',
    'sprint_005_generate_collection',
    'sprint_005_log_collection_reminder',
    'sprint_005_save_collection_followup'
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}`));
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}[^;]+from public, anon`));
  }
  assert.ok((migration.match(/security invoker/g) ?? []).length >= 6);
  assert.match(migration, /has_workspace_role\(p_workspace_id/);
});

test('confirmation, utility and payment routes delegate dependent writes to transactions', () => {
  assert.match(tenancyRoute, /sprint_005_save_extraction_review/);
  assert.match(tenancyRoute, /sprint_005_confirm_tenancy_extraction/);
  assert.match(utilityRoute, /sprint_005_confirm_utility_bill/);
  assert.match(paymentRoute, /sprint_005_record_collection_transaction/);
  assert.match(collectionRoute, /sprint_005_generate_collection/);
  assert.match(reminderRoute, /sprint_005_log_collection_reminder/);
  assert.match(followupRoute, /sprint_005_save_collection_followup/);
  assert.match(paymentRoute, /rollbackStatus: 'rolled-back'/);
  assert.match(utilityRoute, /rollbackStatus: 'rolled-back'/);
});

test('security-definer exceptions are narrowly granted and workspace uniqueness is scoped', () => {
  assert.match(migration, /workspace_setup_open\(\) from public, authenticated/);
  assert.match(migration, /workspace_setup_open\(\) to anon/);
  assert.match(migration, /bootstrap_first_workspace[^;]+from public, anon/);
  assert.match(migration, /sprint_004_system_check\(uuid\) security invoker/);
  assert.match(migration, /documents \(workspace_id, document_hash\)/);
  assert.match(migration, /utility_accounts \(workspace_id, provider, account_number_normalized\)/);
});

test('retry reuses the existing document and enforces its attempt limit', () => {
  assert.match(retryRoute, /processing_attempts/);
  assert.match(retryRoute, /attempts >= maxAttempts/);
  assert.doesNotMatch(retryRoute, /from\('documents'\)\.insert/);
});
