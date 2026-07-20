import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

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

    // Reality check 1: tenancy_documents has a row for this storage_path with tenancy_id IS NOT NULL.
    // This covers the legacy upload path; the FK ON DELETE SET NULL keeps this accurate automatically.
    const tdCheck = await supabase
      .from('tenancy_documents')
      .select('id')
      .eq('storage_path', document.data.storage_path)
      .not('tenancy_id', 'is', null)
      .limit(1);
    if (tdCheck.error) throw tdCheck.error;

    // Reality check 2: document_links has a row pointing to a tenancy that still exists.
    // This covers the new import path (document_links.entity_id has no FK and is not cascade-deleted).
    let hasActiveTenancyLink = (tdCheck.data?.length ?? 0) > 0;
    if (!hasActiveTenancyLink) {
      const dlLinks = await supabase
        .from('document_links')
        .select('entity_id')
        .eq('document_id', params.id)
        .eq('entity_type', 'tenancy');
      if (dlLinks.error) throw dlLinks.error;
      if (dlLinks.data?.length) {
        const tenancyIds = dlLinks.data.map((r) => r.entity_id as string);
        const tenancyCheck = await supabase
          .from('tenancies')
          .select('id')
          .in('id', tenancyIds)
          .eq('workspace_id', workspaceId)
          .limit(1);
        if (tenancyCheck.error) throw tenancyCheck.error;
        hasActiveTenancyLink = (tenancyCheck.data?.length ?? 0) > 0;
      }
    }

    if (hasActiveTenancyLink) {
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
