import { NextResponse } from 'next/server';
import type { CollectionPayload, TenancyPayload } from '../../../../lib/rental/payloads';
import { getApiErrorMessage, getServerSupabaseClient } from '../../../../lib/supabase/server';

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

    const supabase = getServerSupabaseClient();

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

    const tenancyInsert = await supabase.from('tenancies').insert(tenancy).select('*').single();
    if (tenancyInsert.error) throw tenancyInsert.error;
    tenancyId = tenancyInsert.data.id;

    const documentInsert = await supabase
      .from('tenancy_documents')
      .insert({
        tenancy_id: tenancyId,
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
      .insert({ ...collection, tenancy_id: tenancyId })
      .select('*')
      .single();

    if (collectionInsert.error) throw collectionInsert.error;

    return NextResponse.json({
      tenancy: tenancyInsert.data,
      document: documentInsert.data,
      collection: collectionInsert.data
    });
  } catch (error) {
    console.error('Confirm tenancy import failed', error);

    try {
      const supabase = getServerSupabaseClient();
      if (documentId) await supabase.from('tenancy_documents').delete().eq('id', documentId);
      if (tenancyId) await supabase.from('tenancies').delete().eq('id', tenancyId);
    } catch (cleanupError) {
      console.error('Confirm tenancy import cleanup failed', cleanupError);
    }

    return NextResponse.json({ error: getApiErrorMessage(error), stage: documentId ? 'collection' : tenancyId ? 'document' : 'tenancy' }, { status: 500 });
  }
}
