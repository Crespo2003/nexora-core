import { NextResponse } from 'next/server';
import type { TenancyExtraction } from '../../../../lib/ai/tenancyExtractor';
import { sortTimeline, titleForActivity } from '../../../../lib/tenancy-workspace/core';
import type { DocumentRecord, TimelineEvent } from '../../../../lib/tenancy-workspace/types';
import { buildWorkspaceWarnings, tenancyChangesFromExtraction } from '../../../../lib/tenancy-workspace/automation';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';
import { currentIsoDate, normalizeDateForStorage } from '../../../../lib/dates/formatDate';
import { reconcileDocumentLinkedStatus } from '../../../../lib/documents/reconcile';

const editableTenancyFields = new Set([
  'tenant', 'tenant_id_no', 'tenant_phone', 'tenant_email', 'tenant_nationality',
  'tenant_emergency_contact', 'tenant_company', 'tenant_occupation', 'tenant_identity_expiry', 'move_in_date',
  'landlord', 'landlord_phone', 'landlord_email', 'landlord_bank_account',
  'landlord_emergency_contact', 'landlord_preferred_language', 'insurance_expiry', 'property', 'unit_no',
  'property_address', 'property_type', 'occupancy_status', 'monthly_rental',
  'security_deposit', 'utility_deposit', 'access_card_deposit', 'commencement_date',
  'car_park_remote_deposit', 'rental_due_day', 'expiry_date', 'renewal_reminder', 'renewal_option',
  'notice_period', 'special_clauses', 'notes', 'status'
]);
const editableDateFields = new Set(['tenant_identity_expiry', 'move_in_date', 'insurance_expiry', 'commencement_date', 'expiry_date', 'renewal_reminder']);

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireWorkspaceAccess();
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId, role } = auth;

    const tenancyResult = await supabase
      .from('tenancies')
      .select('*')
      .eq('id', params.id)
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (tenancyResult.error) throw tenancyResult.error;
    if (!tenancyResult.data) {
      return NextResponse.json({ error: 'tenancy-not-found' }, { status: 404 });
    }

    const [collectionsResult, accountsResult, billsResult, linksResult] = await Promise.all([
      supabase.from('rental_collections').select('*').eq('tenancy_id', params.id).order('collection_month', { ascending: false }),
      supabase.from('utility_accounts').select('*').eq('tenancy_id', params.id).order('updated_at', { ascending: false }),
      supabase.from('utility_bills').select('*').eq('tenancy_id', params.id).order('created_at', { ascending: false }),
      supabase.from('document_links').select('document_id').eq('entity_type', 'tenancy').eq('entity_id', params.id)
    ]);
    for (const result of [collectionsResult, accountsResult, billsResult, linksResult]) {
      if (result.error) throw result.error;
    }

    const collections = collectionsResult.data ?? [];
    const accounts = accountsResult.data ?? [];
    const bills = billsResult.data ?? [];
    const collectionIds = collections.map((row) => String(row.id));
    const accountIds = accounts.map((row) => String(row.id));
    const linkedDocumentIds = (linksResult.data ?? []).map((row) => String(row.document_id));
    const billDocumentIds = bills.map((row) => row.document_id).filter(Boolean).map(String);
    const documentIds = Array.from(new Set([...linkedDocumentIds, ...billDocumentIds]));

    const [historyResult, paymentsResult, remindersResult, documentsResult, activityResult] = await Promise.all([
      accountIds.length
        ? supabase.from('utility_account_history').select('*').in('utility_account_id', accountIds).order('changed_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      collectionIds.length
        ? supabase.from('collection_payments').select('*').in('rental_collection_id', collectionIds).order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      collectionIds.length
        ? supabase.from('collection_reminders').select('*').in('rental_collection_id', collectionIds).order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      documentIds.length
        ? supabase.from('documents').select('*').in('id', documentIds).order('uploaded_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      supabase.from('activity_logs').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(250)
    ]);
    for (const result of [historyResult, paymentsResult, remindersResult, documentsResult, activityResult]) {
      if (result.error) throw result.error;
    }

    const extractionResult = documentIds.length
      ? await supabase.from('document_extractions').select('*').in('document_id', documentIds).order('updated_at', { ascending: false })
      : { data: [], error: null };
    if (extractionResult.error) throw extractionResult.error;

    const extractionByDocument = new Map<string, Record<string, unknown>>();
    for (const extraction of extractionResult.data ?? []) {
      const documentId = String(extraction.document_id);
      if (!extractionByDocument.has(documentId)) extractionByDocument.set(documentId, extraction);
    }
    const documents = (documentsResult.data ?? []).map((document) => ({
      ...document,
      extraction: extractionByDocument.get(String(document.id)) ?? null
    })) as DocumentRecord[];

    const accountHistory = historyResult.data ?? [];
    const utilityAccounts = accounts.map((account) => ({
      ...account,
      history: accountHistory.filter((entry) => entry.utility_account_id === account.id)
    }));
    const warnings = buildWorkspaceWarnings({
      tenancy: tenancyResult.data,
      collections,
      utilityAccounts,
      utilityBills: bills,
      documents
    });
    const currentCollection = collections[0] ?? null;
    const documentTypes = new Set(documents.map((document) => document.document_type));
    const expectedDocumentTypes = ['tenancy_agreement', 'identity_document', 'inventory_list'];
    const todayIso = currentIsoDate();
    const startOfToday = Date.parse(`${todayIso}T00:00:00Z`);
    const expiryDays = Math.ceil((Date.parse(`${String(tenancyResult.data.expiry_date)}T00:00:00Z`) - startOfToday) / 86_400_000);
    const reminderDays = tenancyResult.data.renewal_reminder
      ? Math.ceil((Date.parse(`${String(tenancyResult.data.renewal_reminder)}T00:00:00Z`) - startOfToday) / 86_400_000)
      : Number.POSITIVE_INFINITY;
    const dashboard = {
      rentalDue: Number(currentCollection?.rental_amount ?? tenancyResult.data.monthly_rental ?? 0),
      utilitiesDue: currentCollection ? ['tnb_amount', 'water_amount', 'iwk_amount', 'wifi_amount', 'aircond_amount', 'other_charges'].reduce((sum, key) => sum + Number(currentCollection[key] ?? 0), 0) : 0,
      outstanding: collections.reduce((sum, collection) => sum + Number(collection.outstanding_balance ?? 0), 0),
      expiringSoon: expiryDays >= 0 && expiryDays <= 90 ? 1 : 0,
      renewals: reminderDays >= 0 && reminderDays <= 90 ? 1 : 0,
      documentsMissing: expectedDocumentTypes.filter((type) => !documentTypes.has(type)).length
    };

    const relevantEntityIds = new Set([
      params.id,
      ...collectionIds,
      ...accountIds,
      ...documentIds,
      ...bills.map((row) => String(row.id))
    ]);
    const timeline: TimelineEvent[] = [{
      id: `tenancy-created-${params.id}`,
      type: 'tenancy_created',
      title: 'Tenancy created',
      detail: String(tenancyResult.data.property ?? ''),
      createdAt: String(tenancyResult.data.created_at)
    }];

    for (const activity of activityResult.data ?? []) {
      const activityJson = (activity.activity_json ?? {}) as Record<string, unknown>;
      if (!relevantEntityIds.has(String(activity.entity_id ?? '')) && String(activityJson.tenancyId ?? '') !== params.id) continue;
      timeline.push({
        id: String(activity.id),
        type: String(activity.activity_type),
        title: titleForActivity(String(activity.activity_type)),
        detail: timelineDetail(activityJson),
        createdAt: String(activity.created_at)
      });
    }
    for (const payment of paymentsResult.data ?? []) {
      timeline.push({
        id: `payment-${payment.id}`,
        type: 'payment_recorded',
        title: payment.transaction_type === 'payment' ? 'Payment received' : 'Payment adjusted',
        detail: `MYR ${Number(payment.amount ?? 0).toFixed(2)}`,
        createdAt: String(payment.created_at)
      });
    }
    for (const reminder of remindersResult.data ?? []) {
      timeline.push({
        id: `reminder-${reminder.id}`,
        type: 'reminder_sent',
        title: reminder.sent_status === 'sent' ? 'Reminder sent' : 'Reminder generated',
        detail: String(reminder.reminder_type ?? ''),
        createdAt: String(reminder.created_at)
      });
    }
    if (tenancyResult.data.renewal_reminder) {
      timeline.push({
        id: `renewal-${params.id}`,
        type: 'renewal_reminder',
        title: 'Renewal reminder',
        detail: String(tenancyResult.data.renewal_option ?? ''),
        createdAt: `${tenancyResult.data.renewal_reminder}T00:00:00Z`
      });
    }

    return NextResponse.json({
      data: {
        tenancy: tenancyResult.data,
        collections,
        currentCollection,
        utilityAccounts,
        utilityBills: bills,
        documents,
        collectionPayments: paymentsResult.data ?? [],
        warnings,
        dashboard,
        timeline: sortTimeline(timeline),
        role
      }
    }, { headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' } });
  } catch (error) {
    return NextResponse.json({ error: getApiErrorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId } = auth;
    const payload = await request.json() as {
      section?: 'tenancy' | 'extraction';
      changes?: Record<string, unknown>;
      extractionId?: string;
      extractedJson?: Record<string, unknown>;
      confirm?: boolean;
    };

    if (payload.section === 'extraction') {
      if (!payload.extractionId || !payload.extractedJson) {
        return NextResponse.json({ error: 'invalid-extraction-update' }, { status: 400 });
      }
      const extraction = await supabase.from('document_extractions').select('id, document_id').eq('id', payload.extractionId).maybeSingle();
      if (extraction.error) throw extraction.error;
      if (!extraction.data) return NextResponse.json({ error: 'extraction-not-found' }, { status: 404 });

      const [link, bill] = await Promise.all([
        supabase.from('document_links').select('id').eq('document_id', extraction.data.document_id).eq('entity_type', 'tenancy').eq('entity_id', params.id).maybeSingle(),
        supabase.from('utility_bills').select('id').eq('document_id', extraction.data.document_id).eq('tenancy_id', params.id).maybeSingle()
      ]);
      if (link.error) throw link.error;
      if (bill.error) throw bill.error;
      if (!link.data && !bill.data) return NextResponse.json({ error: 'extraction-not-found' }, { status: 404 });

      const document = await supabase.from('documents').select('document_type, original_filename').eq('id', extraction.data.document_id).eq('workspace_id', workspaceId).single();
      if (document.error) throw document.error;
      if (!payload.confirm) {
        const review = await supabase.rpc('sprint_005_save_extraction_review', {
          p_workspace_id: workspaceId,
          p_tenancy_id: params.id,
          p_extraction_id: payload.extractionId,
          p_extracted_json: payload.extractedJson
        });
        if (review.error) throw review.error;
        return NextResponse.json({
          success: true, failedStage: null, affectedRecordIds: [payload.extractionId], rollbackStatus: 'atomic-transaction',
          message: { en: 'Corrections saved. Confirm when the values are ready to apply.', zh: '更正已保存。确认资料无误后即可应用。' },
          technicalReference: 'extraction-correction-saved', requiresConfirmation: true
        });
      }

      let tenancyChanges: Record<string, string | number> = {};
      if (document.data.document_type === 'tenancy_agreement') {
        tenancyChanges = tenancyChangesFromExtraction(payload.extractedJson as unknown as TenancyExtraction, true).changes;
        const confirmation = await supabase.rpc('sprint_005_confirm_tenancy_extraction', {
          p_workspace_id: workspaceId,
          p_tenancy_id: params.id,
          p_extraction_id: payload.extractionId,
          p_changes: tenancyChanges,
          p_extracted_json: payload.extractedJson
        });
        if (confirmation.error) throw confirmation.error;
      } else if (document.data.document_type === 'utility_bill') {
        const values = payload.extractedJson as Record<string, unknown>;
        const utilityResponse = await fetch(new URL('/api/utility-bills/confirm', request.url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: request.headers.get('cookie') ?? '' },
          body: JSON.stringify({
            tenancyId: params.id,
            documentId: extraction.data.document_id,
            extractionId: payload.extractionId,
            provider: values.provider,
            accountNumber: values.accountNumber,
            meterNumber: values.meterNumber,
            registeredName: values.registeredName,
            billingAddress: values.serviceAddress,
            billNumber: values.billNumber,
            billMonth: values.billMonth,
            billDate: normalizedWorkflowDate(values.billDate),
            dueDate: normalizedWorkflowDate(values.dueDate),
            totalAmountDue: Number(values.totalAmountDue ?? 0),
            extractedJson: values,
            confidenceJson: { overall: values.confidence ?? 'not_detected' },
            rawExtractedText: values.rawText ?? '',
            sourceFilename: document.data.original_filename,
            createCollectionIfMissing: true,
            collectionMonth: String(values.billMonth ?? '').slice(0, 7)
          })
        });
        const utilityResult = await utilityResponse.json();
        if (!utilityResponse.ok || !utilityResult.success) return NextResponse.json(utilityResult, { status: utilityResponse.status });
        return NextResponse.json(utilityResult);
      } else {
        return NextResponse.json({ success: false, failedStage: 'document-type', affectedRecordIds: [], rollbackStatus: 'not-required', message: { en: 'This document type cannot update tenancy records.', zh: '此文件类型不能更新租约记录。' }, technicalReference: 'unsupported-confirmation-document' }, { status: 400 });
      }
      return NextResponse.json({
        success: true, failedStage: null, affectedRecordIds: [payload.extractionId, extraction.data.document_id, params.id], rollbackStatus: 'atomic-transaction',
        message: { en: 'Extraction confirmed and records updated.', zh: '提取资料已确认，相关记录已更新。' },
        technicalReference: 'extraction-confirmed', tenancyChanges
      });
    }

    const changes = Object.fromEntries(Object.entries(payload.changes ?? {}).flatMap(([key, value]) => {
      if (!editableTenancyFields.has(key)) return [];
      if (!editableDateFields.has(key)) return [[key, value]];
      if (value === null || value === '') return [[key, null]];
      const normalized = normalizeDateForStorage(value);
      return normalized ? [[key, normalized]] : [];
    }));
    if (!Object.keys(changes).length) {
      return NextResponse.json({ error: 'no-valid-fields' }, { status: 400 });
    }
    const update = await supabase.from('tenancies').update(changes)
      .eq('id', params.id).eq('workspace_id', workspaceId).select('*').maybeSingle();
    if (update.error) throw update.error;
    if (!update.data) return NextResponse.json({ error: 'tenancy-not-found' }, { status: 404 });

    const tenancyActivity = await supabase.from('activity_logs').insert({
      workspace_id: workspaceId,
      entity_type: 'tenancy',
      entity_id: params.id,
      activity_type: 'tenancy_updated',
      activity_json: { fields: Object.keys(changes) }
    });
    if (tenancyActivity.error) throw tenancyActivity.error;
    return NextResponse.json({
      success: true, failedStage: null, affectedRecordIds: [params.id], rollbackStatus: 'not-required',
      message: { en: 'Tenancy details updated.', zh: '租约资料已更新。' }, technicalReference: 'tenancy-update-completed',
      tenancy: update.data
    });
  } catch (error) {
    return NextResponse.json({
      success: false, failedStage: 'tenancy-update', affectedRecordIds: [], rollbackStatus: 'manual-review',
      message: { en: 'Tenancy details could not be updated.', zh: '无法更新租约资料。' }, technicalReference: getApiErrorMessage(error)
    }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireWorkspaceAccess(['owner', 'admin'], request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId } = auth;

    // Capture linked document IDs BEFORE deletion because:
    //   • tenancy_documents.tenancy_id will be SET NULL by the FK rule after deletion
    //   • document_links.entity_id has no FK and persists as an orphan after deletion
    const dlLinks = await supabase
      .from('document_links')
      .select('document_id')
      .eq('entity_type', 'tenancy')
      .eq('entity_id', params.id);
    const tdLinks = await supabase
      .from('tenancy_documents')
      .select('storage_path')
      .eq('tenancy_id', params.id)
      .eq('workspace_id', workspaceId);

    const { error } = await supabase.from('tenancies').delete().eq('id', params.id);
    if (error) throw error;

    // Reconcile affected documents: deletes stale document_links and syncs linked_status.
    // Best-effort — failure here does not roll back the successful tenancy deletion.
    const affectedDocIds = new Set<string>();
    for (const row of (dlLinks.data ?? []) as Array<{ document_id: string }>) {
      affectedDocIds.add(row.document_id);
    }
    if (tdLinks.data?.length) {
      const paths = (tdLinks.data as Array<{ storage_path: string }>).map((r) => r.storage_path);
      const docsAtPaths = await supabase
        .from('documents')
        .select('id')
        .in('storage_path', paths)
        .eq('workspace_id', workspaceId);
      for (const row of (docsAtPaths.data ?? []) as Array<{ id: string }>) {
        affectedDocIds.add(row.id);
      }
    }
    if (affectedDocIds.size > 0) {
      await reconcileDocumentLinkedStatus(supabase, workspaceId, [...affectedDocIds]);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Delete tenancy failed');
    return NextResponse.json({ error: getApiErrorMessage(error), stage: 'delete-tenancy' }, { status: 500 });
  }
}

function timelineDetail(value: Record<string, unknown>) {
  const preferred = value.filename ?? value.provider ?? value.collectionMonth ?? value.fields;
  return Array.isArray(preferred) ? preferred.join(', ') : String(preferred ?? '');
}

function normalizedWorkflowDate(value: unknown) {
  const text = String(value ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : null;
}
