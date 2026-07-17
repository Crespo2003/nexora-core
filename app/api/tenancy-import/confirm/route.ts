import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { CollectionPayload, TenancyPayload } from '../../../../lib/rental/payloads';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';
import { logExtractionDiagnostic } from '../../../../lib/ai/extractionDiagnostics';
import { syncExtractedTenancyContacts, type ContactSyncClient } from '../../../../lib/contacts/syncTenancyContacts';

type ImportDocument = {
  originalFilename: string;
  storagePath: string;
  mimeType: string;
  fileSize: number;
  documentType: string;
  uploadStatus: string;
  documentHash: string;
};

function safeDatabaseErrorMessage(code: string, message: string | undefined): string {
  if (code === 'PGRST202') return 'The tenancy import database function is not available.';
  if (code === '23505') return 'A matching tenancy or document already exists in this workspace.';
  if (code === '42501') return 'You do not have permission to save this tenancy in the active workspace.';
  if (code === '22023') return 'The tenancy import payload is incomplete or invalid.';
  if (code === '42P01' || code === '42703') return 'The tenancy import database schema is incomplete.';

  const knownMessage = String(message ?? '').trim();
  if (/^(authentication required|workspace permission denied|document_hash_required|incomplete tenancy import payload)$/i.test(knownMessage)) {
    return knownMessage;
  }
  return `The tenancy database operation failed${code ? ` (${code})` : ''}.`;
}

export async function POST(request: Request) {
  const requestId = request.headers.get('x-vercel-id') ?? randomUUID();
  const startedAt = Date.now();

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
      return NextResponse.json({
        success: false,
        requestId,
        stage: 'auth',
        code: 'authorization-failed',
        error: payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : 'authorization-failed',
        details: {}
      }, { status: auth.status });
    }
    const { supabase, workspaceId, role } = auth;
    logExtractionDiagnostic('confirmation_authorized', {
      requestId,
      stage: 'auth',
      authenticated: true,
      workspaceId,
      role
    });
    if (clientWorkspaceId && clientWorkspaceId !== workspaceId) {
      return NextResponse.json({
        success: false,
        requestId,
        stage: 'auth',
        code: 'workspace-mismatch',
        error: 'workspace-mismatch',
        details: {}
      }, { status: 403 });
    }
    const rpcName = 'upload_end_to_end_import_tenancy';
    logExtractionDiagnostic('confirmation_database_started', { requestId, stage: 'database', workspaceId, rpcName });
    const imported = await supabase.rpc(rpcName, {
      p_workspace_id: workspaceId,
      p_payload: { tenancy, collection, document, extraction }
    });
    if (imported.error) {
      const failure = imported.error as { code?: string; message?: string; details?: string; hint?: string };
      const postgrestCode = failure.code ?? '';
      logExtractionDiagnostic('confirmation_database_failed', {
        requestId,
        stage: 'database',
        workspaceId,
        rpcName,
        postgrestCode,
        errorCode: postgrestCode || 'database-rpc-failed',
        elapsedMs: Date.now() - startedAt
      });
      console.error('[tenancy-extraction] confirmation_database_failed', {
        requestId,
        rpcName,
        postgrestCode,
        safeReason: safeDatabaseErrorMessage(postgrestCode, failure.message),
        hasDetails: Boolean(failure.details),
        hasHint: Boolean(failure.hint)
      });
      return NextResponse.json({
        success: false,
        requestId,
        stage: 'database',
        code: postgrestCode || 'database-rpc-failed',
        error: safeDatabaseErrorMessage(postgrestCode, failure.message),
        details: {
          postgrestCode: postgrestCode || null
        }
      }, { status: postgrestCode === '23505' ? 409 : 500 });
    }
    const result = imported.data as {
      tenancy: Record<string, unknown>;
      document: Record<string, unknown>;
      documentCentre: Record<string, unknown>;
      extraction: Record<string, unknown>;
      documentExtraction: Record<string, unknown>;
      collection: Record<string, unknown>;
      payment: Record<string, unknown> | null;
      warnings?: string[];
      idempotentReplay?: boolean;
    };

    const documentId = String(result.documentCentre?.id ?? result.document?.id ?? '');
    const extractionId = String(result.documentExtraction?.id ?? result.extraction?.id ?? '');
    const tenancyId = String(result.tenancy?.id ?? '');
    const warnings = Array.isArray(result.warnings) ? [...result.warnings] : [];
    if (tenancyId) {
      try {
        const contacts = await syncExtractedTenancyContacts({
          supabase: supabase as unknown as ContactSyncClient,
          workspaceId,
          tenancyId,
          extraction: extraction.extractedJson
        });
        warnings.push(...contacts.warnings);
        logExtractionDiagnostic('confirmation_contacts_synced', {
          requestId,
          stage: 'database',
          workspaceId,
          tenancyId,
          linkedContactCount: contacts.linked,
          warningCount: contacts.warnings.length
        });
      } catch (error) {
        warnings.push('Extracted contacts require review before they can be linked to this tenancy.');
        console.error('[tenancy-extraction] confirmation_contact_sync_failed', {
          requestId,
          tenancyId,
          errorCode: getApiErrorMessage(error)
        });
      }
    }
    logExtractionDiagnostic('confirmation_database_completed', {
      requestId,
      stage: 'database',
      workspaceId,
      rpcName,
      persisted: true,
      elapsedMs: Date.now() - startedAt
    });
    return NextResponse.json({
      success: true,
      requestId,
      documentId,
      extractionId,
      tenancyId,
      provider: extraction.confidenceJson && typeof extraction.confidenceJson === 'object' && 'provider' in extraction.confidenceJson
        ? String(extraction.confidenceJson.provider ?? '')
        : '',
      model: extraction.model ?? '',
      warnings,
      data: {
        tenancy: result.tenancy,
        document: result.documentCentre ?? result.document,
        extraction: result.documentExtraction ?? result.extraction,
        idempotentReplay: Boolean(result.idempotentReplay)
      },
      tenancy: result.tenancy,
      document: result.document,
      documentCentre: result.documentCentre,
      extraction: result.extraction,
      documentExtraction: result.documentExtraction,
      collection: result.collection,
      payment: result.payment
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'unknown-error';
    console.error('[tenancy-extraction] confirm_import_failed', {
      requestId,
      errorCode: getApiErrorMessage(error),
      errorName: error instanceof Error ? error.name : typeof error
    });
    const duplicate = typeof error === 'object' && error && 'code' in error && String(error.code) === '23505';
    logExtractionDiagnostic('confirmation_failed', {
      requestId,
      stage: 'database',
      errorCode: duplicate ? '23505' : getApiErrorMessage(error),
      elapsedMs: Date.now() - startedAt
    });
    return NextResponse.json(
      {
        success: false,
        requestId,
        stage: 'database',
        code: duplicate ? '23505' : getApiErrorMessage(error),
        error: duplicate ? 'duplicate-tenancy' : safeDatabaseErrorMessage(getApiErrorMessage(error), message),
        details: {}
      },
      { status: duplicate ? 409 : 500 }
    );
  }
}
