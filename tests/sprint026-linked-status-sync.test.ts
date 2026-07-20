import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const deleteDocRoute = readFileSync('app/api/documents/[id]/route.ts', 'utf8');
const uploadRoute = readFileSync('app/api/documents/upload/route.ts', 'utf8');
const tenancyRoute = readFileSync('app/api/tenancies/[id]/route.ts', 'utf8');
const reconcileModule = readFileSync('lib/documents/reconcile.ts', 'utf8');
const persistenceMigration = readFileSync('supabase/migrations/202607171300_upload_end_to_end_persistence.sql', 'utf8');
const repairMigration = readFileSync('supabase/migrations/20260721000001_repair_document_linked_status.sql', 'utf8');
const staleLinksMigration = readFileSync('supabase/migrations/20260721120000_remove_stale_document_links.sql', 'utf8');

// 1. Upload regression: duplicate hash check still prevents uploading the same file twice.
test('upload route still blocks duplicate uploads by document_hash', () => {
  assert.ok(uploadRoute.includes('document_hash'), 'upload route must hash-check against documents table');
  assert.ok(uploadRoute.includes('duplicate-document'), 'duplicate-document error code must be returned');
  assert.match(uploadRoute, /status.*409/, 'HTTP 409 required for duplicate uploads');
});

// 2. Import regression: the import RPC sets linked_status = 'linked' when a document is imported.
test('import tenancy RPC marks the document as linked after successful import', () => {
  assert.ok(persistenceMigration.includes("linked_status = 'linked'"), 'upload_end_to_end_import_tenancy RPC must set linked_status to linked');
  assert.ok(persistenceMigration.includes('document_links'), 'RPC must insert a document_links row');
  assert.ok(persistenceMigration.includes('tenancy_documents'), 'RPC must insert a tenancy_documents row for the legacy path');
});

// 3. Delete tenancy: reconcile is called after deletion to sync linked_status and remove stale document_links.
test('tenancy DELETE route calls reconcile to sync linked_status and clean stale links after tenancy removal', () => {
  assert.ok(tenancyRoute.includes('document_links'), 'tenancy DELETE must capture document_links rows before deletion');
  assert.ok(tenancyRoute.includes('tenancy_documents'), 'tenancy DELETE must capture tenancy_documents rows before deletion');
  assert.ok(tenancyRoute.includes('reconcileDocumentLinkedStatus'), 'tenancy DELETE must call reconcile helper — not inline update');
  assert.ok(reconcileModule.includes("linked_status: 'unlinked'"), 'reconcile module must set linked_status to unlinked for orphaned docs');
  assert.ok(tenancyRoute.includes('workspaceId'), 'tenancy DELETE must pass workspaceId from auth, not rely on RLS alone');
});

// 4. Reconcile module: checks tenancy_documents.tenancy_id IS NOT NULL (legacy path).
// The document DELETE route calls reconcile, which performs this check internally.
test('reconcile module checks tenancy_documents.tenancy_id IS NOT NULL before marking a doc as linked', () => {
  assert.ok(deleteDocRoute.includes('reconcileDocumentLinkedStatus'), 'delete route must call the reconcile helper');
  assert.ok(reconcileModule.includes('tenancy_documents'), 'reconcile must query tenancy_documents table');
  assert.ok(reconcileModule.includes('tenancy_id'), 'reconcile must filter by tenancy_id column');
  assert.match(reconcileModule, /not.*tenancy_id.*is.*null|\.not\(.*tenancy_id.*is.*null/i, 'reconcile must use .not(tenancy_id, is, null) or equivalent');
});

// 5. Reconcile module: verifies tenancy still exists via document_links → tenancies join.
// Covers the new import path where document_links.entity_id has no FK to tenancies.
test('reconcile module joins document_links to tenancies to confirm the tenancy is still active', () => {
  assert.ok(reconcileModule.includes('document_links'), 'reconcile must query document_links');
  assert.ok(reconcileModule.includes('tenancies'), 'reconcile must verify tenancy row still exists in tenancies table');
  assert.ok(reconcileModule.includes("'tenancy'"), 'reconcile must filter document_links by entity_type tenancy');
  assert.ok(reconcileModule.includes('staleLinkIds'), 'reconcile must identify and delete stale document_links rows');
  assert.ok(deleteDocRoute.includes('linked-document'), 'linked-document error code must be returned for blocked deletion');
  assert.match(deleteDocRoute, /status.*409/, 'HTTP 409 required for linked-document rejection');
});

// 6. Upload same filename again: hard-deleting the document row removes its hash so re-upload is unblocked.
test('hard-deleting a document removes its document_hash so the same file can be re-uploaded', () => {
  assert.ok(!deleteDocRoute.includes('deleted_at'), 'delete must be hard — no soft-delete column');
  assert.ok(!deleteDocRoute.includes('archived_at'), 'delete must be hard — no archived_at column');
  assert.ok(deleteDocRoute.includes('.delete()'), 'documents row must be hard-deleted by the route');
  assert.ok(uploadRoute.includes('document_hash'), 'upload route checks hash — once deleted, re-upload is permitted');
});

// 7. Migration repair: the repair SQL corrects all stale linked_status rows on deployment.
test('repair migration fixes stale linked_status rows that have no remaining active tenancy link', () => {
  assert.ok(repairMigration.includes("linked_status = 'unlinked'"), 'repair must SET linked_status to unlinked');
  assert.ok(repairMigration.includes("linked_status = 'linked'"), 'repair must only target currently-linked documents');
  assert.ok(repairMigration.includes('tenancy_documents'), 'repair must check the legacy tenancy_documents path');
  assert.ok(repairMigration.includes('document_links'), 'repair must check the new document_links path');
  assert.ok(repairMigration.includes('tenancy_id is not null'), 'repair must exclude documents still linked via tenancy_documents');
  assert.ok(repairMigration.includes('inner join'), 'repair must inner join document_links to tenancies to confirm active link');
});

// 8. Stale-links migration: removes orphaned document_links pointing to deleted tenancies.
test('stale-links migration deletes document_links rows that have no matching tenancy', () => {
  assert.ok(staleLinksMigration.includes('delete from public.document_links'), 'migration must delete from document_links');
  assert.ok(staleLinksMigration.includes("entity_type = 'tenancy'"), 'migration must scope to tenancy entity_type');
  assert.ok(staleLinksMigration.includes('not exists'), 'migration must use NOT EXISTS to find orphaned rows');
  assert.ok(staleLinksMigration.includes('public.tenancies'), 'migration must check against the tenancies table');
});
