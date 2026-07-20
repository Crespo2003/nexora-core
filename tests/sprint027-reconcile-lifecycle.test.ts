import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const deleteDocRoute = readFileSync('app/api/documents/[id]/route.ts', 'utf8');
const tenancyRoute = readFileSync('app/api/tenancies/[id]/route.ts', 'utf8');
const documentsPage = readFileSync('app/documents/page.tsx', 'utf8');
const reconcileModule = readFileSync('lib/documents/reconcile.ts', 'utf8');
const staleLinksMigration = readFileSync('supabase/migrations/20260721120000_remove_stale_document_links.sql', 'utf8');
const repairMigration = readFileSync('supabase/migrations/20260721000001_repair_document_linked_status.sql', 'utf8');

// 1. Frontend: stale linked_status in the browser does NOT block the DELETE API call.
// The early-return guard based on cached linked_status has been removed.
test('frontend deleteDocument function no longer short-circuits based on stale linked_status', () => {
  assert.ok(!documentsPage.includes("deleteDocument(documentId: string, linkedStatus"), 'deleteDocument must not accept linkedStatus param — stale client-side gate removed');
  assert.ok(!documentsPage.includes('onDelete(document.id, document.linkedStatus)'), 'onDelete call must not pass cached linkedStatus — let server decide');
  assert.ok(documentsPage.includes('deleteDocument'), 'deleteDocument handler must still exist');
  assert.ok(documentsPage.includes('confirmDeleteDocument'), 'user must still confirm before delete is attempted');
  assert.ok(documentsPage.includes('linked-document'), 'frontend must still handle the server 409 linked-document error');
});

// 2. Frontend: onDelete prop accepts a single documentId — no longer passes linkedStatus.
// Removing the linkedStatus param closes the stale-cache attack surface on the client.
test('DocumentReview onDelete prop takes documentId only — linkedStatus is no longer passed client-side', () => {
  assert.ok(!documentsPage.includes("onDelete(document.id, document.linkedStatus)"), 'linkedStatus must not be passed to onDelete');
  assert.ok(documentsPage.includes("onDelete(document.id)"), 'onDelete must be called with documentId only');
  assert.ok(!documentsPage.includes("onDelete: (documentId: string, linkedStatus: string)"), 'onDelete prop must not accept linkedStatus');
});

// 3. Reconcile: exports reconcileDocumentLinkedStatus and returns linkedDocumentIds Set.
test('reconcileDocumentLinkedStatus is exported and returns a Set of actively linked document IDs', () => {
  assert.ok(reconcileModule.includes('export async function reconcileDocumentLinkedStatus'), 'function must be exported');
  assert.ok(reconcileModule.includes('linkedDocumentIds'), 'return value must include linkedDocumentIds');
  assert.ok(reconcileModule.includes('ReconcileResult'), 'return type must be typed via ReconcileResult interface');
});

// 4. Reconcile: deletes stale document_links pointing to tenancies that no longer exist.
// This ensures each call to the delete route cleans up after past tenancy deletions.
test('reconcile module deletes stale document_links whose entity tenancy no longer exists', () => {
  assert.ok(reconcileModule.includes('staleLinkIds'), 'reconcile must identify stale link IDs');
  assert.ok(reconcileModule.includes("from('document_links').delete()"), 'reconcile must hard-delete stale rows from document_links');
  assert.ok(reconcileModule.includes('existingTenancyIds'), 'reconcile must verify which tenancy IDs still exist before deleting');
});

// 5. Reconcile: syncs linked_status = 'unlinked' for docs with no remaining active link.
test('reconcile module sets linked_status to unlinked for documents with no surviving tenancy link', () => {
  assert.ok(reconcileModule.includes("linked_status: 'unlinked'"), 'reconcile must write unlinked status for orphaned docs');
  assert.ok(reconcileModule.includes("eq('linked_status', 'linked')"), 'reconcile must only update currently-linked documents — avoid spurious writes');
});

// 6. Reconcile: workspace isolation — always filters documents by workspaceId.
test('reconcile module enforces workspace isolation when updating documents.linked_status', () => {
  const workspaceFilterCount = [...reconcileModule.matchAll(/eq\(['"]workspace_id['"]/g)].length;
  assert.ok(workspaceFilterCount >= 2, `reconcile must filter by workspace_id at least twice (tenancies check + documents update), found ${workspaceFilterCount}`);
});

// 7. Tenancy DELETE: calls reconcile after deletion — cleans stale document_links AND syncs linked_status.
// This replaces the former manual linked_status update with the shared helper.
test('tenancy DELETE route calls reconcile and no longer does its own inline linked_status update', () => {
  assert.ok(tenancyRoute.includes('reconcileDocumentLinkedStatus'), 'tenancy DELETE must delegate to reconcile helper');
  assert.ok(!tenancyRoute.includes("linked_status: 'unlinked'"), 'tenancy DELETE must not have an inline linked_status update — reconcile handles it');
  assert.ok(tenancyRoute.includes('document_links'), 'tenancy DELETE still captures document_links before deletion');
  assert.ok(tenancyRoute.includes('tenancy_documents'), 'tenancy DELETE still captures tenancy_documents before deletion');
});

// 8. Document DELETE: uses reconcile result, returns 409 for linked docs and deletes unlinked docs.
test('document DELETE route uses reconcile result to gate deletion and hard-deletes the documents row', () => {
  assert.ok(deleteDocRoute.includes('reconcileDocumentLinkedStatus'), 'delete route must call reconcile');
  assert.ok(deleteDocRoute.includes('linkedDocumentIds'), 'delete route must check the returned linkedDocumentIds Set');
  assert.ok(deleteDocRoute.includes('linked-document'), 'linked-document error code must be returned when reconcile reports an active link');
  assert.match(deleteDocRoute, /status.*409/, 'HTTP 409 must be returned for linked documents');
  assert.ok(deleteDocRoute.includes('.delete()'), 'unlinked documents must be hard-deleted');
  assert.ok(deleteDocRoute.includes('storage_bucket'), 'delete route must also remove the storage object');
});

// 9. Stale-links migration: deletes orphaned document_links on deployment.
test('stale-links migration removes all orphaned document_links rows that have no matching tenancy', () => {
  assert.ok(staleLinksMigration.includes('delete from public.document_links'), 'must delete from document_links');
  assert.ok(staleLinksMigration.includes("entity_type = 'tenancy'"), 'must scope the deletion to tenancy entity type');
  assert.ok(staleLinksMigration.includes('not exists'), 'must use NOT EXISTS to identify orphaned rows');
  assert.ok(staleLinksMigration.includes('public.tenancies'), 'must check against tenancies table');
});

// 10. Repair migration and stale-links migration are both present and complementary.
// The repair migration fixes linked_status; the stale-links migration removes orphaned document_links.
test('both repair migrations are present and cover the two stale-data scenarios', () => {
  assert.ok(repairMigration.includes("linked_status = 'unlinked'"), 'repair migration must fix linked_status');
  assert.ok(staleLinksMigration.includes('delete from public.document_links'), 'stale-links migration must remove orphaned rows');
  assert.ok(repairMigration.includes('document_links'), 'repair migration must reference document_links in its NOT EXISTS check');
  assert.ok(staleLinksMigration.includes('public.tenancies'), 'stale-links migration must reference tenancies table');
});
