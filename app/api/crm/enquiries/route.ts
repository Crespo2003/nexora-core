import { NextResponse } from 'next/server';
import { writeActivity } from '../../../../lib/activity/log';
import { CRM_READ_ROLES, CRM_WRITE_ROLES, createRecordNumber, crmError, escapePostgrestSearch, protectCrmContact, safePage } from '../../../../lib/crm/api';
import { normalizeCrmEmail, normalizeCrmPhone, normalizeCrmText, normalizeStringList, nullableNumber } from '../../../../lib/crm/normalize';
import { canManageCrmRecord } from '../../../../lib/crm/permissions';
import { isCrmPipelineStage, validateCrmStageTransition } from '../../../../lib/crm/pipeline';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(CRM_READ_ROLES, request);
    if (auth instanceof Response) return auth;
    const url = new URL(request.url);
    const { page, pageSize, from, to } = safePage(url.searchParams);
    const search = escapePostgrestSearch(url.searchParams.get('q')?.trim() ?? '');
    const stage = url.searchParams.get('stage');
    const priority = url.searchParams.get('priority');
    const assigned = url.searchParams.get('assigned');
    const view = url.searchParams.get('view') ?? 'active';

    let query = auth.supabase
      .from('crm_enquiries')
      .select('*, contact:contacts(id,client_type,contact_type,full_name,company_name,phone_original,phone_normalized,whatsapp_number,email,preferred_language,notes)', { count: 'exact' })
      .eq('workspace_id', auth.workspaceId)
      .order('updated_at', { ascending: false })
      .range(from, to);
    query = view === 'archived' ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
    if (stage && isCrmPipelineStage(stage)) query = query.eq('stage', stage);
    if (priority && ['hot', 'warm', 'normal', 'low'].includes(priority)) query = query.eq('priority', priority);
    if (assigned === 'me') query = query.eq('assigned_user_id', auth.user.id);
    else if (assigned) query = query.eq('assigned_user_id', assigned);
    if (search) query = query.or(`enquiry_number.ilike.%${search}%,property_type.ilike.%${search}%,notes.ilike.%${search}%`);
    const result = await query;
    if (result.error) throw result.error;

    const rows = (result.data ?? []).map((row) => {
      const record = row as Record<string, unknown>;
      const contact = record.contact as Record<string, unknown> | null;
      return { ...record, contact: contact ? protectCrmContact(contact, auth.role) : null };
    });
    return NextResponse.json({ success: true, rows, count: result.count ?? 0, page, pageSize, role: auth.role, userId: auth.user.id });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}

export async function POST(request: Request) {
  try {
    const tooLarge = rejectOversizedRequest(request, 64_000);
    if (tooLarge) return tooLarge;
    const auth = await requireWorkspaceAccess(CRM_WRITE_ROLES, request);
    if (auth instanceof Response) return auth;
    const body = await request.json() as Record<string, unknown>;
    const contactInput = (body.contact ?? {}) as Record<string, unknown>;
    const fullName = normalizeCrmText(contactInput.fullName ?? body.fullName, 200);
    const companyName = normalizeCrmText(contactInput.companyName ?? body.companyName, 200);
    const phone = normalizeCrmPhone(contactInput.phone ?? body.phone);
    const email = normalizeCrmEmail(contactInput.email ?? body.email);
    const transactionType = normalizeCrmText(body.transactionType, 40);
    if ((!fullName && !companyName) || !['rent', 'buy', 'subsale', 'commercial_rent', 'commercial_buy', 'land', 'new_project'].includes(transactionType)) {
      return crmError(400, 'invalid-enquiry');
    }

    let contactId = normalizeCrmText(body.existingContactId, 80);
    let duplicateRows: Record<string, unknown>[] = [];
    if (!contactId && (phone || email || fullName || companyName)) {
      const filters = [
        phone ? `phone_normalized.eq.${phone}` : '',
        email ? `email.ilike.${email}` : '',
        fullName ? `full_name.ilike.${escapePostgrestSearch(fullName)}` : '',
        companyName ? `company_name.ilike.${escapePostgrestSearch(companyName)}` : '',
      ].filter(Boolean).join(',');
      const duplicates = await auth.supabase
        .from('contacts')
        .select('id,full_name,company_name,phone_original,email,client_type')
        .eq('workspace_id', auth.workspaceId)
        .or(filters)
        .is('archived_at', null)
        .limit(5);
      if (duplicates.error) throw duplicates.error;
      duplicateRows = (duplicates.data ?? []) as Record<string, unknown>[];
      if (duplicateRows.length && body.confirmDuplicate !== true) {
        return crmError(409, 'possible-duplicate-client', {
          duplicateWarning: true,
          matches: duplicateRows.map((row) => protectCrmContact(row, auth.role)),
        });
      }
      if (duplicateRows.length) contactId = String(duplicateRows[0].id);
    }

    if (!contactId) {
      const contact = await auth.supabase.from('contacts').insert({
        workspace_id: auth.workspaceId,
        contact_type: companyName && !fullName ? 'company' : 'person',
        client_type: ['prospect','tenant','buyer','investor','landlord','owner','commercial_tenant','commercial_buyer','company','other'].includes(String(contactInput.clientType)) ? contactInput.clientType : 'prospect',
        nationality: normalizeCrmText(contactInput.nationality ?? body.nationality, 120),
        full_name: fullName,
        company_name: companyName,
        phone_original: normalizeCrmText(contactInput.phone ?? body.phone, 80),
        phone_normalized: phone,
        whatsapp_number: normalizeCrmText(contactInput.whatsapp ?? body.whatsapp, 80),
        email,
        preferred_language: ['en', 'zh', 'bilingual'].includes(String(contactInput.preferredLanguage)) ? contactInput.preferredLanguage : 'en',
        source: normalizeCrmText(body.source, 120),
        notes: normalizeCrmText(contactInput.notes, 2_000),
        assigned_user_id: auth.user.id,
        created_by: auth.user.id,
      }).select('id').single();
      if (contact.error) throw contact.error;
      contactId = String(contact.data.id);
      void writeActivity(auth.supabase, auth.workspaceId, 'contact', contactId, 'client_created', { fullName, companyName }, auth.user.id);
    }

    const assignedUserId = auth.role === 'agent' ? auth.user.id : normalizeCrmText(body.assignedUserId, 80) || auth.user.id;
    const enquiry = await auth.supabase.from('crm_enquiries').insert({
      workspace_id: auth.workspaceId,
      enquiry_number: createRecordNumber('ENQ'),
      contact_id: contactId,
      transaction_type: transactionType,
      property_type: normalizeCrmText(body.propertyType, 120),
      preferred_areas: normalizeStringList(body.preferredAreas),
      budget_min: nullableNumber(body.budgetMin),
      budget_max: nullableNumber(body.budgetMax),
      bedrooms_min: nullableNumber(body.bedroomsMin),
      bathrooms_min: nullableNumber(body.bathroomsMin),
      size_min: nullableNumber(body.sizeMin),
      size_max: nullableNumber(body.sizeMax),
      furnishing: normalizeCrmText(body.furnishing, 80),
      move_in_date: body.moveInDate || null,
      commercial_requirements: normalizeCrmText(body.commercialRequirements, 4_000),
      source: normalizeCrmText(body.source, 120),
      parking_requirement: normalizeCrmText(body.parkingRequirement, 500),
      pet_requirement: normalizeCrmText(body.petRequirement, 500),
      special_requirements: normalizeCrmText(body.specialRequirements, 4_000),
      priority: ['hot', 'warm', 'normal', 'low'].includes(String(body.priority)) ? body.priority : 'normal',
      stage: 'NEW_ENQUIRY',
      notes: normalizeCrmText(body.notes, 4_000),
      assigned_user_id: assignedUserId,
      created_by: auth.user.id,
      next_follow_up_at: body.nextFollowUpAt || null,
    }).select('*, contact:contacts(*)').single();
    if (enquiry.error) throw enquiry.error;
    void writeActivity(auth.supabase, auth.workspaceId, 'enquiry', enquiry.data.id, 'enquiry_created', {
      enquiryNumber: enquiry.data.enquiry_number,
      title: fullName || companyName,
    }, auth.user.id);
    return NextResponse.json({ success: true, record: enquiry.data, reusedContact: duplicateRows.length > 0 }, { status: 201 });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const tooLarge = rejectOversizedRequest(request, 64_000);
    if (tooLarge) return tooLarge;
    const auth = await requireWorkspaceAccess(CRM_WRITE_ROLES, request);
    if (auth instanceof Response) return auth;
    const body = await request.json() as Record<string, unknown>;
    const id = normalizeCrmText(body.id, 80);
    if (!id) return crmError(400, 'record-id-required');
    const current = await auth.supabase.from('crm_enquiries').select('*').eq('workspace_id', auth.workspaceId).eq('id', id).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) return crmError(404, 'enquiry-not-found');
    if (!canManageCrmRecord(auth.role, current.data.assigned_user_id, auth.user.id)) return crmError(403, 'permission-denied');

    const action = normalizeCrmText(body.action, 50);
    if (action === 'convert-to-deal') {
      const contact = await auth.supabase.from('contacts').select('full_name,company_name').eq('workspace_id', auth.workspaceId).eq('id', current.data.contact_id).single();
      if (contact.error) throw contact.error;
      const deal = await auth.supabase.from('crm_deals').insert({
        workspace_id: auth.workspaceId,
        deal_number: createRecordNumber('DEAL'),
        title: normalizeCrmText(body.title, 200) || contact.data.full_name || contact.data.company_name || current.data.enquiry_number,
        contact_id: current.data.contact_id,
        enquiry_id: current.data.id,
        transaction_type: current.data.transaction_type,
        stage: current.data.stage,
        assigned_user_id: current.data.assigned_user_id,
        created_by: auth.user.id,
        deal_value: nullableNumber(body.dealValue),
        notes: normalizeCrmText(body.notes, 4_000),
      }).select('*').single();
      if (deal.error) throw deal.error;
      void writeActivity(auth.supabase, auth.workspaceId, 'deal', deal.data.id, 'deal_created', { title: deal.data.title, enquiryId: id }, auth.user.id);
      return NextResponse.json({ success: true, record: deal.data });
    }

    const changes: Record<string, unknown> = {};
    if ('stage' in body) {
      if (!isCrmPipelineStage(body.stage) || !validateCrmStageTransition(current.data.stage, body.stage)) {
        return crmError(409, 'invalid-stage-transition', { currentStage: current.data.stage });
      }
      changes.stage = body.stage;
      if (body.stage === 'LOST') {
        const reason = normalizeCrmText(body.lostReason, 1_000);
        if (!reason) return crmError(400, 'lost-reason-required');
        changes.lost_reason = reason;
        changes.status = 'lost';
      } else if (body.stage === 'CLOSED' || body.stage === 'AFTER_SALES') {
        changes.status = 'closed';
      }
    }
    if (action === 'archive') {
      changes.archived_at = new Date().toISOString();
      changes.status = 'archived';
    }
    const textFields: Record<string, number> = {
      property_type: 120, furnishing: 80, parking_requirement: 500, pet_requirement: 500,
      special_requirements: 4_000, commercial_requirements: 4_000,
      source: 120, notes: 4_000, lost_reason: 1_000,
    };
    for (const [field, max] of Object.entries(textFields)) if (field in body) changes[field] = normalizeCrmText(body[field], max);
    if ('preferred_areas' in body) changes.preferred_areas = normalizeStringList(body.preferred_areas);
    for (const field of ['budget_min', 'budget_max', 'bedrooms_min', 'bathrooms_min', 'size_min', 'size_max']) {
      if (field in body) changes[field] = nullableNumber(body[field]);
    }
    if ('priority' in body && ['hot', 'warm', 'normal', 'low'].includes(String(body.priority))) changes.priority = body.priority;
    if ('move_in_date' in body) changes.move_in_date = body.move_in_date || null;
    if ('next_follow_up_at' in body) changes.next_follow_up_at = body.next_follow_up_at || null;
    if ('assigned_user_id' in body && auth.role !== 'agent') changes.assigned_user_id = body.assigned_user_id || null;
    if (!Object.keys(changes).length) return crmError(400, 'no-valid-fields');
    const updated = await auth.supabase.from('crm_enquiries').update(changes).eq('workspace_id', auth.workspaceId).eq('id', id).select('*').single();
    if (updated.error) throw updated.error;
    void writeActivity(auth.supabase, auth.workspaceId, 'enquiry', id,
      changes.stage ? 'enquiry_stage_changed' : action === 'archive' ? 'enquiry_archived' : 'crm_updated',
      { fromStage: current.data.stage, toStage: changes.stage, changedFields: Object.keys(changes) }, auth.user.id);
    return NextResponse.json({ success: true, record: updated.data });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}
