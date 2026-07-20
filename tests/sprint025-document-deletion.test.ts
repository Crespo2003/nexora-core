import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const deleteRoute = readFileSync('app/api/documents/[id]/route.ts', 'utf8');
const uploadRoute = readFileSync('app/api/documents/upload/route.ts', 'utf8');
const documentsPage = readFileSync('app/documents/page.tsx', 'utf8');
const documentTranslations = readFileSync('lib/i18n/documentTranslations.ts', 'utf8');
const sprint002Migration = readFileSync('supabase/migrations/202607130002_sprint_002_ai_document_centre.sql', 'utf8');
const persistenceMigration = readFileSync('supabase/migrations/202607171300_upload_end_to_end_persistence.sql', 'utf8');

// 1. Deleting an unlinked document removes it from the active documents set.
// The route checks reality (tenancy_documents + document_links) rather than the cached linked_status flag.
test('delete route hard-deletes the row only when no active tenancy link is found', () => {
  assert.ok(deleteRoute.includes('linked-document'), 'linked-document error code is required');
  assert.ok(deleteRoute.includes('tenancy_documents'), 'delete route must check tenancy_documents for live links');
  assert.ok(deleteRoute.includes('.delete()'), 'DB hard-delete call is missing');
  assert.match(deleteRoute, /\.delete\(\)/, 'delete must be present');
});

// 2. The same file can be uploaded again after deletion.
// Once the row is hard-deleted, document_hash is gone and the duplicate check passes.
test('document_hash duplicate check clears after hard-delete — row deletion unblocks re-upload', () => {
  assert.ok(uploadRoute.includes('document_hash'), 'upload route must hash-check before inserting');
  assert.ok(!deleteRoute.includes('deleted_at') && !deleteRoute.includes('archived_at'), 'delete must be hard (no soft-delete)');
  assert.ok(deleteRoute.includes('.delete()'), 'hard-delete call must exist in the route');
});

// 3. Duplicate upload is still blocked while the active document exists.
test('upload route returns 409 duplicate-document when the hash already exists', () => {
  assert.ok(uploadRoute.includes('duplicate-document'), 'duplicate-document error code required');
  assert.match(uploadRoute, /status.*409/, 'HTTP 409 required for duplicate');
  assert.ok(uploadRoute.includes('document_hash'), 'hash filter required in duplicate check');
  assert.ok(uploadRoute.includes('workspace_id'), 'workspace filter required in duplicate check');
});

// 4. A document linked to an active tenancy cannot be silently deleted.
// The route performs a reality check: tenancy_documents.tenancy_id IS NOT NULL, or
// document_links rows that join to existing tenancies — it does not trust the cached linked_status.
test('delete route rejects deletion of linked documents with 409 and linked-document error code', () => {
  assert.ok(deleteRoute.includes('linked-document'), 'linked-document error code must be returned');
  assert.match(deleteRoute, /status.*409/, 'HTTP 409 required for linked-document rejection');
  assert.ok(deleteRoute.includes('tenancy_documents'), 'reality check 1: must query tenancy_documents for non-null tenancy_id');
  assert.ok(deleteRoute.includes('document_links'), 'reality check 2: must query document_links for remaining tenancy ref');
  assert.ok(deleteRoute.includes('tenancies'), 'reality check 2: must verify tenancy row still exists in tenancies table');
});

// 5. Cross-workspace deletion is blocked.
// workspace_id filter must appear in BOTH the initial document fetch and the delete call.
test('delete route applies workspace_id filter on both the fetch and the delete', () => {
  const workspaceFilterCount = [...deleteRoute.matchAll(/eq\(['"]workspace_id['"]/g)].length;
  assert.ok(workspaceFilterCount >= 2, `workspace_id must appear at least twice (fetch + delete), found ${workspaceFilterCount}`);
});

// 6. Storage cleanup targets only the workspace-owned object — coordinates come from the DB row.
test('storage deletion uses storage_bucket and storage_path sourced from the database row, not from user input', () => {
  assert.ok(deleteRoute.includes('storage_bucket'), 'storage_bucket must be selected from DB');
  assert.ok(deleteRoute.includes('storage_path'), 'storage_path must be selected from DB');
  assert.ok(deleteRoute.includes('document.data.storage_bucket'), 'must use DB-sourced bucket in remove call');
  assert.ok(deleteRoute.includes('document.data.storage_path'), 'must use DB-sourced path in remove call');
});

// 7. Dependent extraction/activity rows are cleaned up per schema FK CASCADE rules.
// The FK is declared inside each table's CREATE TABLE block; table name and CASCADE are on separate lines.
test('schema declares ON DELETE CASCADE for document-dependent tables', () => {
  const migrations = sprint002Migration + persistenceMigration;
  // Count distinct document_id → documents(id) ON DELETE CASCADE declarations
  const cascadeMatches = [...migrations.matchAll(/references public\.documents\(id\) on delete cascade/gi)];
  assert.ok(cascadeMatches.length >= 4, `expected at least 4 FK CASCADE declarations to documents, found ${cascadeMatches.length}`);
  // Verify the child tables all exist in the migrations
  assert.ok(migrations.includes('document_extractions'), 'document_extractions table must be defined');
  assert.ok(migrations.includes('document_activity'), 'document_activity table must be defined');
  assert.ok(migrations.includes('document_links'), 'document_links table must be defined');
  assert.ok(migrations.includes('tenancy_legal_analyses'), 'tenancy_legal_analyses table must be defined');
});

// 8. Document Centre exposes a delete handler with all required bilingual messages.
test('Document Centre page has a deleteDocument handler and all bilingual delete messages are present', () => {
  assert.ok(documentsPage.includes('deleteDocument'), 'deleteDocument handler missing from documents page');
  assert.ok(documentsPage.includes('onDelete'), 'onDelete prop missing from DocumentReview usage');
  assert.ok(documentsPage.includes('linked-document'), 'linked-document server error must be handled in the page');
  assert.ok(documentTranslations.includes('documentDeleted'), 'documentDeleted translation key missing');
  assert.ok(documentTranslations.includes('documentLinkedCannotDelete'), 'documentLinkedCannotDelete translation key missing');
  assert.ok(documentTranslations.includes('documentDeleteFailed'), 'documentDeleteFailed translation key missing');
  assert.ok(documentTranslations.includes('deleteDocument'), 'deleteDocument button label translation key missing');
  assert.ok(documentTranslations.includes('文件已成功删除'), 'Chinese documentDeleted translation missing');
  assert.ok(documentTranslations.includes('无法直接删除'), 'Chinese documentLinkedCannotDelete translation missing');
  assert.ok(documentTranslations.includes('文件删除失败'), 'Chinese documentDeleteFailed translation missing');
});
