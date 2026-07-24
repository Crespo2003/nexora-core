import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';
import { reconcileDocumentLinkedStatus } from '../../../../lib/documents/reconcile';

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireWorkspaceAccess(['owner', 'admin'], request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId } = auth;

    const document = await supabase.from('documents')
      .select('id, storage_bucket, storage_path')
      .eq('id', params.id).eq('workspace_id', workspaceId).maybeSingle();
    if (document.error) throw document.error;
    if (!document.data) return NextResponse.json({ error: 'document-not-found' }, { status: 404 });

    // Reconcile: removes stale document_links, checks both link paths, syncs linked_status.
    // Returns which documents are still actively linked to a real tenancy in this workspace.
    const { linkedDocumentIds } = await reconcileDocumentLinkedStatus(supabase, workspaceId, [params.id]);

    if (linkedDocumentIds.has(params.id)) {
      return NextResponse.json({ error: 'linked-document' }, { status: 409 });
    }

    // Best-effort storage deletion — a missing file is not an error
    await supabase.storage.from(document.data.storage_bucket).remove([document.data.storage_path]);

    const recordDelete = await supabase.from('documents').delete().eq('id', params.id).eq('workspace_id', workspaceId);
    if (recordDelete.error) throw recordDelete.error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: getApiErrorMessage(error) }, { status: 500 });
  }
}
