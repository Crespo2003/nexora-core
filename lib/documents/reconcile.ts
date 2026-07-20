import type { AuthContext } from '../supabase/server';

type RouteSupabase = AuthContext['supabase'];

export interface ReconcileResult {
  linkedDocumentIds: Set<string>;
}

export async function reconcileDocumentLinkedStatus(
  supabase: RouteSupabase,
  workspaceId: string,
  documentIds: string[]
): Promise<ReconcileResult> {
  if (documentIds.length === 0) return { linkedDocumentIds: new Set() };

  // 1. Fetch all document_links for these documents pointing to tenancies
  const dlResult = await supabase
    .from('document_links')
    .select('id, document_id, entity_id')
    .in('document_id', documentIds)
    .eq('entity_type', 'tenancy');
  if (dlResult.error) throw dlResult.error;
  const allLinks = (dlResult.data ?? []) as Array<{ id: string; document_id: string; entity_id: string }>;

  // 2. Find which referenced tenancies still exist in this workspace
  const referencedTenancyIds = [...new Set(allLinks.map((r) => r.entity_id))];
  const existingTenancyIds = new Set<string>();
  if (referencedTenancyIds.length > 0) {
    const tenancyResult = await supabase
      .from('tenancies')
      .select('id')
      .in('id', referencedTenancyIds)
      .eq('workspace_id', workspaceId);
    if (tenancyResult.error) throw tenancyResult.error;
    for (const row of (tenancyResult.data ?? []) as Array<{ id: string }>) {
      existingTenancyIds.add(row.id);
    }
  }

  // 3. Delete stale document_links (pointing to tenancies that no longer exist in this workspace)
  const staleLinkIds = allLinks
    .filter((r) => !existingTenancyIds.has(r.entity_id))
    .map((r) => r.id);
  if (staleLinkIds.length > 0) {
    const deleteResult = await supabase.from('document_links').delete().in('id', staleLinkIds);
    if (deleteResult.error) throw deleteResult.error;
  }

  // 4. Track docs still linked via an active document_links row
  const activeDocumentIds = new Set(
    allLinks.filter((r) => existingTenancyIds.has(r.entity_id)).map((r) => r.document_id)
  );

  // 5. Check legacy path: tenancy_documents.tenancy_id IS NOT NULL (FK ON DELETE SET NULL keeps this accurate)
  const docsResult = await supabase
    .from('documents')
    .select('id, storage_path')
    .in('id', documentIds)
    .eq('workspace_id', workspaceId);
  if (docsResult.error) throw docsResult.error;
  const docs = (docsResult.data ?? []) as Array<{ id: string; storage_path: string }>;
  const storagePaths = docs.map((r) => r.storage_path);
  const pathToDocId = new Map(docs.map((r) => [r.storage_path, r.id]));

  if (storagePaths.length > 0) {
    const tdResult = await supabase
      .from('tenancy_documents')
      .select('storage_path')
      .in('storage_path', storagePaths)
      .not('tenancy_id', 'is', null);
    if (tdResult.error) throw tdResult.error;
    for (const row of (tdResult.data ?? []) as Array<{ storage_path: string }>) {
      const docId = pathToDocId.get(row.storage_path);
      if (docId) activeDocumentIds.add(docId);
    }
  }

  // 6. Sync documents.linked_status to reflect reality
  const unlinkedIds = documentIds.filter((id) => !activeDocumentIds.has(id));
  const linkedIds = documentIds.filter((id) => activeDocumentIds.has(id));
  if (unlinkedIds.length > 0) {
    const r = await supabase
      .from('documents')
      .update({ linked_status: 'unlinked' })
      .in('id', unlinkedIds)
      .eq('workspace_id', workspaceId)
      .eq('linked_status', 'linked');
    if (r.error) throw r.error;
  }
  if (linkedIds.length > 0) {
    const r = await supabase
      .from('documents')
      .update({ linked_status: 'linked' })
      .in('id', linkedIds)
      .eq('workspace_id', workspaceId)
      .eq('linked_status', 'unlinked');
    if (r.error) throw r.error;
  }

  return { linkedDocumentIds: activeDocumentIds };
}
