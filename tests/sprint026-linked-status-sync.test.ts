import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const deleteDocRoute = readFileSync('app/api/documents/[id]/route.ts', 'utf8');
const uploadRoute = readFileSync('app/api/documents/upload/route.ts', 'utf8');
const tenancyRoute = readFileSync('app/api/tenancies/[id]/route.ts', 'utf8');
const persistenceMigration = readFileSync('supabase/migrations/202607171300_upload_end_to_end_persistence.sql', 'utf8');
const repairMigration = readFileSync('supabase/migrations/20260721000001_repair_document_linked_status.sql', 'utf8');

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

// 3. Delete tenancy: linked_status is synced to 'unlinked' for affected documents after tenancy deletion.
test('tenancy DELETE route syncs documents.linked_status to unlinked after the tenancy row is removed', () => {
  assert.ok(tenancyRoute.includes('document_links'), 'tenancy DELETE must capture document_links rows before deletion');
  assert.ok(tenancyRoute.includes('tenancy_documents'), 'tenancy DELETE must capture tenancy_documents rows before deletion');
  assert.ok(tenancyRoute.includes("linked_status: 'unlinked'"), 'tenancy DELETE must set linked_status to unlinked');
  assert.ok(tenancyRoute.includes("eq('linked_status', 'linked')"), 'update must only target currently-linked documents');
  assert.ok(tenancyRoute.includes('workspaceId'), 'tenancy DELETE must pass workspaceId from auth, not rely on RLS alone');
});

// 4. Unlink check: document delete route reads tenancy_documents.tenancy_id to detect live legacy links.
// tenancy_documents.tenancy_id IS NULL after the tenancy is deleted (FK ON DELETE SET NULL).
test('document DELETE route checks tenancy_documents.tenancy_id IS NOT NULL before blocking deletion', () => {
  assert.ok(deleteDocRoute.includes('tenancy_documents'), 'delete route must query tenancy_documents table');
  assert.ok(deleteDocRoute.includes('tenancy_id'), 'delete route must filter by tenancy_id column');
  assert.match(deleteDocRoute, /not.*tenancy_id.*is.*null|\.not\(.*tenancy_id.*is.*null/i, 'delete route must use .not(tenancy_id, is, null) or equivalent');
});

// 5. Delete document: delete route verifies the tenancy still exists via document_links + tenancies join.
// This covers the new import path where document_links.entity_id is not FK-constrained.
test('document DELETE route joins document_links to tenancies to confirm the tenancy is still active', () => {
  assert.ok(deleteDocRoute.includes('document_links'), 'delete route must query document_links');
  assert.ok(deleteDocRoute.includes('tenancies'), 'delete route must verify tenancy row still exists');
  assert.ok(deleteDocRoute.includes("'tenancy'"), 'delete route must filter document_links by entity_type tenancy');
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
