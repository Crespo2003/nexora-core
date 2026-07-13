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
};

export async function POST(request: Request) {
  let tenancyId: string | null = null;
  let documentId: string | null = null;
  let supabase: any;

  try {
    const { tenancy, collection, document, extraction } = (await request.json()) as {
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
      };
    };

    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    ({ supabase } = auth);
    const { workspaceId } = auth;

    const duplicate = await supabase
      .from('tenancies')
      .select('id')
      .eq('tenant', tenancy.tenant)
      .eq('property', tenancy.property)
      .eq('unit_no', tenancy.unit_no ?? '')
      .maybeSingle();

    if (duplicate.error) throw duplicate.error;
    if (duplicate.data) {
      return NextResponse.json({ error: 'duplicate-tenancy', stage: 'duplicate-check' }, { status: 409 });
    }

    const tenancyInsert = await supabase.from('tenancies').insert({ ...tenancy, workspace_id: workspaceId }).select('*').single();
    if (tenancyInsert.error) throw tenancyInsert.error;
    tenancyId = tenancyInsert.data.id;

    const documentInsert = await supabase
      .from('tenancy_documents')
      .insert({
        tenancy_id: tenancyId,
        workspace_id: workspaceId,
        original_filename: document.originalFilename,
        storage_path: document.storagePath,
        mime_type: document.mimeType,
        file_size: document.fileSize,
        document_type: document.documentType,
        upload_status: document.uploadStatus
      })
      .select('*')
      .single();

    if (documentInsert.error) throw documentInsert.error;
    documentId = documentInsert.data.id;

    const extractionInsert = await supabase.from('tenancy_extractions').insert({
      tenancy_document_id: documentId,
      workspace_id: workspaceId,
      extraction_status: extraction.extractionStatus,
      extracted_json: extraction.extractedJson,
      raw_text: extraction.rawText,
      ai_summary: extraction.aiSummary,
      confidence_json: extraction.confidenceJson,
      extraction_error: extraction.extractionError ?? null
    });

    if (extractionInsert.error) throw extractionInsert.error;

    const collectionInsert = await supabase
      .from('rental_collections')
      .insert({ ...collection, tenancy_id: tenancyId, workspace_id: workspaceId })
      .select('*')
      .single();

    if (collectionInsert.error) throw collectionInsert.error;

    return NextResponse.json({
      tenancy: tenancyInsert.data,
      document: documentInsert.data,
      collection: collectionInsert.data
    });
  } catch (error) {
    console.error('Confirm tenancy import failed');

    try {
      if (supabase && documentId) await supabase.from('tenancy_documents').delete().eq('id', documentId);
      if (supabase && tenancyId) await supabase.from('tenancies').delete().eq('id', tenancyId);
    } catch (cleanupError) {
      console.error('Confirm tenancy import cleanup failed');
    }

    return NextResponse.json({ error: getApiErrorMessage(error), stage: documentId ? 'collection' : tenancyId ? 'document' : 'tenancy' }, { status: 500 });
  }
}
