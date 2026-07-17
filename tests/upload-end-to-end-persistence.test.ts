import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/202607171300_upload_end_to_end_persistence.sql', 'utf8');
const tenantCompanyCompatibility = readFileSync('supabase/migrations/202607171315_upload_end_to_end_tenant_company_compatibility.sql', 'utf8');
const securityInvokerMigration = readFileSync('supabase/migrations/202607171330_upload_end_to_end_security_invoker.sql', 'utf8');
const confirmRoute = readFileSync('app/api/tenancy-import/confirm/route.ts', 'utf8');
const uploadHandler = readFileSync('lib/tenancy/tenancyUploadHandler.ts', 'utf8');

test('upload end-to-end migration provides the exact PostgREST RPC contract', () => {
  assert.match(migration, /create or replace function public\.upload_end_to_end_import_tenancy\s*\(\s*p_workspace_id uuid,\s*p_payload jsonb/i);
  assert.match(migration, /create or replace function public\.upload_end_to_end_preserve_failed_upload\s*\(\s*p_workspace_id uuid,\s*p_payload jsonb/i);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.upload_end_to_end_import_tenancy\(uuid, jsonb\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.upload_end_to_end_import_tenancy\(uuid, jsonb\) to authenticated/i);
  assert.match(migration, /create or replace function public\.sprint_015_import_tenancy_legal_intelligence/i);
  assert.match(migration, /select public\.upload_end_to_end_import_tenancy\(p_workspace_id, p_payload\)/i);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
});

test('base import records are transactional, workspace-scoped, and idempotent', () => {
  for (const table of [
    'documents', 'document_extractions', 'tenancies', 'tenancy_documents',
    'tenancy_extractions', 'document_links', 'rental_collections',
    'collection_payments', 'activity_logs'
  ]) {
    assert.match(migration, new RegExp(`(?:insert into|update) public\\.${table}\\b`, 'i'));
  }
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /drop index if exists public\.documents_document_hash_unique/i);
  assert.match(migration, /documents_workspace_document_hash_unique/i);
  assert.match(migration, /idempotentReplay/i);
  assert.match(migration, /where workspace_id = p_workspace_id/i);
  assert.match(migration, /tenancies_workspace_tenant_property_unit_unique/i);
});

test('legal persistence cannot roll back a successful base extraction', () => {
  assert.match(migration, /Optional intelligence is deliberately isolated/i);
  assert.match(migration, /exception when others then\s*v_warnings := v_warnings \|\| jsonb_build_array\('legal_intelligence_persistence_failed'\)/i);
  for (const table of ['tenancy_legal_analyses', 'tenancy_legal_clauses', 'tenancy_legal_risks']) {
    assert.match(migration, new RegExp(`public\\.${table}`, 'i'));
  }
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /private\.is_workspace_member/i);
  assert.match(migration, /private\.has_workspace_role/i);
});

test('TXT support and the per-workspace uniqueness correction are explicit', () => {
  assert.match(migration, /'text\/plain'/i);
  assert.match(migration, /drop constraint if exists tenancies_unique_tenant_property_unit/i);
  assert.match(migration, /workspace_id, tenant, property, unit_no/i);
});

test('the current mapped tenant-company field is compatible with legacy production schema', () => {
  assert.match(migration, /add column if not exists tenant_company text not null default ''/i);
  assert.match(tenantCompanyCompatibility, /add column if not exists tenant_company text not null default ''/i);
  assert.match(tenantCompanyCompatibility, /notify pgrst, 'reload schema'/i);
});

test('the import RPC runs with caller RLS and only grants the already-authorized agent collection write', () => {
  assert.match(securityInvokerMigration, /rental_collections workspace insert/i);
  assert.match(securityInvokerMigration, /collection_payments workspace insert/i);
  assert.match(securityInvokerMigration, /array\['owner', 'admin', 'manager', 'agent', 'finance'\]/i);
  assert.match(securityInvokerMigration, /alter function public\.upload_end_to_end_import_tenancy\(uuid, jsonb\) security invoker/i);
  assert.match(securityInvokerMigration, /alter function public\.sprint_015_import_tenancy_legal_intelligence\(uuid, jsonb\) security invoker/i);
});

test('confirmation returns a complete JSON success and precise database failure contract', () => {
  assert.match(confirmRoute, /const rpcName = 'upload_end_to_end_import_tenancy'/);
  assert.match(confirmRoute, /stage: 'database'/);
  assert.match(confirmRoute, /postgrestCode/i);
  assert.match(confirmRoute, /safeDatabaseErrorMessage/);
  assert.match(confirmRoute, /hasDetails: Boolean\(failure\.details\)/);
  assert.doesNotMatch(confirmRoute, /details: String\(failure\.details/);
  for (const key of ['requestId', 'documentId', 'extractionId', 'tenancyId', 'provider', 'model', 'warnings', 'data']) {
    assert.match(confirmRoute, new RegExp(`${key}[,:]`, 'i'));
  }
  assert.doesNotMatch(confirmRoute, /sprint_015_import_tenancy_legal_intelligence/);
});

test('upload failure preservation no longer depends on the missing historical RPC', () => {
  assert.match(uploadHandler, /upload_end_to_end_preserve_failed_upload/);
  assert.doesNotMatch(uploadHandler, /sprint_005_create_document_bundle/);
  assert.match(uploadHandler, /documentHash = createHash\('sha256'\)/);
  assert.match(uploadHandler, /rollbackStatus: 'document-preserved'/);
});
