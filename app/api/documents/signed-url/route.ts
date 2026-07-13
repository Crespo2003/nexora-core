import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export async function POST(request: Request) {
  try {
    const { documentId, disposition = 'inline' } = (await request.json()) as {
      documentId?: string;
      disposition?: 'inline' | 'attachment';
    };

    if (!documentId) {
      return NextResponse.json({ error: 'document-unavailable', stage: 'signed-url' }, { status: 400 });
    }

    const auth = await requireWorkspaceAccess(undefined, request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId } = auth;
    const { data: document, error: documentError } = await supabase
      .from('documents')
      .select('storage_bucket, storage_path, original_filename')
      .eq('id', documentId)
      .eq('workspace_id', workspaceId)
      .single();

    if (documentError) throw documentError;

    const { data, error } = await supabase.storage
      .from(document.storage_bucket)
      .createSignedUrl(document.storage_path, 300, {
        download: disposition === 'attachment' ? document.original_filename : false
      });

    if (error) throw error;

    await supabase.from('document_activity').insert({
      document_id: documentId,
      workspace_id: workspaceId,
      activity_type: disposition === 'attachment' ? 'document_downloaded' : 'document_viewed',
      activity_json: { expiresIn: 300 }
    });

    return NextResponse.json({ signedUrl: data.signedUrl, expiresIn: 300 });
  } catch (error) {
    console.error('Document Centre signed URL failed');
    return NextResponse.json({ error: getApiErrorMessage(error), stage: 'signed-url' }, { status: 500 });
  }
}
