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

    const storageDelete = await supabase.storage.from(document.data.storage_bucket).remove([document.data.storage_path]);
    if (storageDelete.error) throw storageDelete.error;
    const recordDelete = await supabase.from('documents').delete().eq('id', params.id).eq('workspace_id', workspaceId);
    if (recordDelete.error) throw recordDelete.error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: getApiErrorMessage(error) }, { status: 500 });
  }
}
