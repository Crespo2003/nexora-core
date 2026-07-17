import { NextResponse } from 'next/server';
import type { CollectionPayload, TenancyPayload } from '../../../../lib/rental/payloads';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

type ImportDocument = {
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  documentType: string;
  uploadStatus: string;
  documentHash: string;
};

export async function POST(request: Request) {
  try {
    const { workspaceId: clientWorkspaceId, tenancy, collection, document, extraction } = (await request.json()) as {
      workspaceId?: string;
      tenancy: TenancyPayload;
      collection: Omit<CollectionPayload, 'tenancy_id'>;
      document: ImportDocument;
      extraction: {
        extractionStatus: string;
        extractedJson: unknown;
        rawText: string;
        aiSummary: string;
        confidenceJson: unknown;
        extractionError?: string | null;
        model?: string;
      };
    };

    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) {
      const payload: unknown = await auth.clone().json().catch(() => ({ success: false, error: 'authorization-failed' }));
      return NextResponse.json(payload, { status: auth.status });
    }
    const { supabase, workspaceId } = auth;
    if (clientWorkspaceId && clientWorkspaceId !== workspaceId) {
      return NextResponse.json({ success: false, error: 'workspace-mismatch', stage: 'authorization' }, { status: 403 });
    }
    const imported = await supabase.rpc('sprint_015_import_tenancy_legal_intelligence', {
      p_workspace_id: workspaceId,
      p_payload: { tenancy, collection, document, extraction }
    });
    if (imported.error) throw imported.error;
    const result = imported.data as {
      tenancy: Record<string, unknown>;
      document: Record<string, unknown>;
      extraction: Record<string, unknown>;
      collection: Record<string, unknown>;
      payment: Record<string, unknown> | null;
    };

    return NextResponse.json({
      success: true,
      tenancy: result.tenancy,
      document: result.document,
      extraction: result.extraction,
      collection: result.collection,
      payment: result.payment
    });
  } catch (error) {
    console.error('[tenancy-extraction] confirm_import_failed', { error: error instanceof Error ? error.message.slice(0, 500) : 'unknown-error' });
    const duplicate = typeof error === 'object' && error && 'code' in error && String(error.code) === '23505';
    return NextResponse.json(
      { success: false, error: duplicate ? 'duplicate-tenancy' : getApiErrorMessage(error), stage: duplicate ? 'duplicate-check' : 'atomic-import' },
      { status: duplicate ? 409 : 500 }
    );
  }
}
