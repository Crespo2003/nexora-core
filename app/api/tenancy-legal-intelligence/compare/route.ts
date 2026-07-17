import { NextResponse } from 'next/server';
import { buildLegalIntelligence, compareLegalIntelligence } from '../../../../lib/legal-intelligence/core';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const maxComparisonRequestBytes = 8 * 1024;

export async function POST(request: Request) {
  try {
    const oversized = rejectOversizedRequest(request, maxComparisonRequestBytes);
    if (oversized) return oversized;
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    const payload = await request.json() as { documentAId?: unknown; documentBId?: unknown };
    const documentAId = typeof payload.documentAId === 'string' ? payload.documentAId : '';
    const documentBId = typeof payload.documentBId === 'string' ? payload.documentBId : '';
    if (!documentAId || !documentBId || documentAId === documentBId) {
      return NextResponse.json({ error: 'two-different-documents-required' }, { status: 400 });
    }

    const extractions = await auth.supabase
      .from('document_extractions')
      .select('document_id, extracted_json, raw_text, updated_at')
      .eq('workspace_id', auth.workspaceId)
      .in('document_id', [documentAId, documentBId])
      .order('updated_at', { ascending: false });
    if (extractions.error) throw extractions.error;
    const byDocument = new Map<string, { extracted_json: unknown; raw_text: string }>();
    for (const extraction of extractions.data ?? []) {
      const id = String(extraction.document_id);
      if (!byDocument.has(id)) byDocument.set(id, { extracted_json: extraction.extracted_json, raw_text: String(extraction.raw_text ?? '') });
    }
    const extractionA = byDocument.get(documentAId);
    const extractionB = byDocument.get(documentBId);
    if (!extractionA || !extractionB) return NextResponse.json({ error: 'legal-analysis-not-found' }, { status: 404 });

    const comparison = compareLegalIntelligence(
      buildLegalIntelligence(extractionA.extracted_json, extractionA.raw_text),
      buildLegalIntelligence(extractionB.extracted_json, extractionB.raw_text)
    );
    const persisted = await auth.supabase.rpc('sprint_015_save_tenancy_comparison', {
      p_workspace_id: auth.workspaceId,
      p_document_a_id: documentAId,
      p_document_b_id: documentBId,
      p_comparison: comparison
    });
    if (persisted.error) throw persisted.error;
    return NextResponse.json({ comparison, persistence: persisted.data }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } });
  } catch (error) {
    console.error('Legal agreement comparison failed');
    return NextResponse.json({ error: getApiErrorMessage(error) }, { status: 500 });
  }
}
