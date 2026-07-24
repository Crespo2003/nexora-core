import { NextResponse } from 'next/server';
import { writeActivity } from '../../../../lib/activity/log';
import { CRM_READ_ROLES, CRM_WRITE_ROLES, createRecordNumber, crmError, safePage } from '../../../../lib/crm/api';
import { normalizeCrmText, nullableNumber } from '../../../../lib/crm/normalize';
import { canManageCrmRecord } from '../../../../lib/crm/permissions';
import { isCrmPipelineStage, validateCrmStageTransition } from '../../../../lib/crm/pipeline';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(CRM_READ_ROLES, request);
    if (auth instanceof Response) return auth;
    const url = new URL(request.url);
    const { page, pageSize, from, to } = safePage(url.searchParams);
    let query = auth.supabase.from('crm_deals')
      .select('*, contact:contacts(id,full_name,company_name), enquiry:crm_enquiries(id,enquiry_number)', { count: 'exact' })
      .eq('workspace_id', auth.workspaceId).is('archived_at', null)
      .order('updated_at', { ascending: false }).range(from, to);
    const stage = url.searchParams.get('stage');
    if (stage && isCrmPipelineStage(stage)) query = query.eq('stage', stage);
    const result = await query;
    if (result.error) throw result.error;
    return NextResponse.json({ success: true, rows: result.data ?? [], count: result.count ?? 0, page, pageSize, role: auth.role, userId: auth.user.id });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(CRM_WRITE_ROLES, request);
    if (auth instanceof Response) return auth;
    const body = await request.json() as Record<string, unknown>;
    const title = normalizeCrmText(body.title, 200);
    const contactId = normalizeCrmText(body.contact_id ?? body.contactId, 80);
    const transactionType = normalizeCrmText(body.transaction_type ?? body.transactionType, 40);
    if (!title || !contactId || !['rent','buy','subsale','commercial_rent','commercial_buy','land','new_project'].includes(transactionType)) return crmError(400, 'invalid-deal');
    const assignedUserId = auth.role === 'agent' ? auth.user.id : normalizeCrmText(body.assigned_user_id ?? body.assignedUserId, 80) || auth.user.id;
    const result = await auth.supabase.from('crm_deals').insert({
      workspace_id: auth.workspaceId,
      deal_number: createRecordNumber('DEAL'),
      title,
      contact_id: contactId,
      enquiry_id: body.enquiry_id || body.enquiryId || null,
      transaction_type: transactionType,
      commercial_listing_id: body.commercial_listing_id || body.commercialListingId || null,
      listing_reference: normalizeCrmText(body.listing_reference ?? body.listingReference, 200),
      stage: isCrmPipelineStage(body.stage) ? body.stage : 'NEW_ENQUIRY',
      deal_value: nullableNumber(body.deal_value ?? body.dealValue),
      expected_commission: nullableNumber(body.expected_commission ?? body.expectedCommission),
      probability: nullableNumber(body.probability),
      notes: normalizeCrmText(body.notes, 4_000),
      assigned_user_id: assignedUserId,
      created_by: auth.user.id,
    }).select('*').single();
    if (result.error) throw result.error;
    void writeActivity(auth.supabase, auth.workspaceId, 'deal', result.data.id, 'deal_created', { title }, auth.user.id);
    return NextResponse.json({ success: true, record: result.data }, { status: 201 });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(CRM_WRITE_ROLES, request);
    if (auth instanceof Response) return auth;
    const body = await request.json() as Record<string, unknown>;
    const id = normalizeCrmText(body.id, 80);
    const current = await auth.supabase.from('crm_deals').select('*').eq('workspace_id', auth.workspaceId).eq('id', id).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) return crmError(404, 'deal-not-found');
    if (!canManageCrmRecord(auth.role, current.data.assigned_user_id, auth.user.id)) return crmError(403, 'permission-denied');
    const changes: Record<string, unknown> = {};
    if ('stage' in body) {
      if (!isCrmPipelineStage(body.stage) || !validateCrmStageTransition(current.data.stage, body.stage)) return crmError(409, 'invalid-stage-transition');
      changes.stage = body.stage;
      if (body.stage === 'LOST') {
        const reason = normalizeCrmText(body.lost_reason ?? body.lostReason, 1_000);
        if (!reason) return crmError(400, 'lost-reason-required');
        changes.lost_reason = reason; changes.status = 'lost';
      }
      if (body.stage === 'CLOSED' || body.stage === 'AFTER_SALES') {
        changes.status = 'closed'; changes.closed_at = new Date().toISOString();
      }
    }
    for (const field of ['title','listing_reference','notes']) if (field in body) changes[field] = normalizeCrmText(body[field], field === 'notes' ? 4_000 : 200);
    for (const field of ['deal_value','expected_commission','probability']) if (field in body) changes[field] = nullableNumber(body[field]);
    if (!Object.keys(changes).length) return crmError(400, 'no-valid-fields');
    const result = await auth.supabase.from('crm_deals').update(changes).eq('workspace_id', auth.workspaceId).eq('id', id).select('*').single();
    if (result.error) throw result.error;
    void writeActivity(auth.supabase, auth.workspaceId, 'deal', id, changes.stage ? 'deal_stage_changed' : 'crm_updated', { fromStage: current.data.stage, toStage: changes.stage }, auth.user.id);
    return NextResponse.json({ success: true, record: result.data });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}
