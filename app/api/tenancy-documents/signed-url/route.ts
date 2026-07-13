import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const storageBucket = 'real-estate-documents';

export async function POST(request: Request) {
  try {
    const { storagePath } = (await request.json()) as { storagePath?: string };

    if (!storagePath) {
      return NextResponse.json({ error: 'Document unavailable.', stage: 'signed-url' }, { status: 400 });
    }

    const auth = await requireWorkspaceAccess(undefined, request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId } = auth;
    const document = await supabase
      .from('tenancy_documents')
      .select('id')
      .eq('storage_path', storagePath)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (document.error) throw document.error;
    if (!document.data) {
      return NextResponse.json({ error: 'Document unavailable.', stage: 'signed-url' }, { status: 404 });
    }

    const { data, error } = await supabase.storage.from(storageBucket).createSignedUrl(storagePath, 60 * 5);
    if (error) throw error;

    return NextResponse.json({ signedUrl: data.signedUrl, expiresIn: 300 });
  } catch (error) {
    console.error('Create document signed URL failed');
    return NextResponse.json({ error: getApiErrorMessage(error), stage: 'signed-url' }, { status: 500 });
  }
}
