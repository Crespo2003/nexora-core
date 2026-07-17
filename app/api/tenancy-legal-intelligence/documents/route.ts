import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(undefined, request);
    if (auth instanceof Response) return auth;

    const analyses = await auth.supabase
      .from('tenancy_legal_analyses')
      .select('document_id, executive_summary, updated_at')
      .eq('workspace_id', auth.workspaceId)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (analyses.error) throw analyses.error;

    const ids = [...new Set((analyses.data ?? []).map((analysis) => String(analysis.document_id)).filter(Boolean))];
    if (!ids.length) return NextResponse.json({ documents: [] }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
    const documents = await auth.supabase
      .from('documents')
      .select('id, original_filename, document_type')
      .eq('workspace_id', auth.workspaceId)
      .in('id', ids);
    if (documents.error) throw documents.error;
    const byId = new Map((documents.data ?? []).map((document) => [String(document.id), document]));

    return NextResponse.json({
      documents: (analyses.data ?? []).flatMap((analysis) => {
        const document = byId.get(String(analysis.document_id));
        if (!document) return [];
        return [{
          id: String(document.id),
          filename: String(document.original_filename ?? 'Untitled agreement'),
          documentType: String(document.document_type ?? 'tenancy_agreement'),
          executiveSummary: String(analysis.executive_summary ?? ''),
          updatedAt: String(analysis.updated_at ?? '')
        }];
      })
    }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error) {
    console.error('Legal intelligence document listing failed');
    return NextResponse.json({ error: getApiErrorMessage(error) }, { status: 500 });
  }
}
