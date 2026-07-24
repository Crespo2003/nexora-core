import { NextResponse } from 'next/server';
import { writeActivity } from '../../../../lib/activity/log';
import { CRM_READ_ROLES, CRM_WRITE_ROLES, crmError, safePage } from '../../../../lib/crm/api';
import { normalizeCrmText } from '../../../../lib/crm/normalize';
import { canManageCrmRecord } from '../../../../lib/crm/permissions';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const statuses = ['pending', 'completed', 'snoozed', 'cancelled'];
const methods = ['whatsapp', 'call', 'email', 'meeting', 'viewing', 'internal_task'];
const priorities = ['low', 'medium', 'high', 'urgent'];

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(CRM_READ_ROLES, request);
    if (auth instanceof Response) return auth;
    const url = new URL(request.url);
    const { page, pageSize, from, to } = safePage(url.searchParams);
    const status = url.searchParams.get('status');
    const bucket = url.searchParams.get('bucket');
    const now = new Date();
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    let query = auth.supabase
      .from('crm_follow_ups')
      .select('*, contact:contacts(id,full_name,company_name), enquiry:crm_enquiries(id,enquiry_number,stage), deal:crm_deals(id,deal_number,title,stage)', { count: 'exact' })
      .eq('workspace_id', auth.workspaceId)
      .order('due_at', { ascending: true })
      .range(from, to);
    if (status && statuses.includes(status)) query = query.eq('status', status);
    if (bucket === 'overdue') query = query.eq('status', 'pending').lt('due_at', now.toISOString());
    if (bucket === 'today') query = query.eq('status', 'pending').gte('due_at', new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()).lte('due_at', todayEnd.toISOString());
    if (bucket === 'upcoming') query = query.eq('status', 'pending').gt('due_at', todayEnd.toISOString());
    const result = await query;
    if (result.error) throw result.error;
    const rows = (result.data ?? []).map((row) => ({
      ...row,
      status: row.status === 'pending' && new Date(row.due_at).getTime() < Date.now() ? 'overdue' : row.status,
    }));
    return NextResponse.json({ success: true, rows, count: result.count ?? 0, page, pageSize, role: auth.role, userId: auth.user.id });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}

export async function POST(request: Request) {
  try {
    const tooLarge = rejectOversizedRequest(request, 32_000);
    if (tooLarge) return tooLarge;
    const auth = await requireWorkspaceAccess(CRM_WRITE_ROLES, request);
    if (auth instanceof Response) return auth;
    const body = await request.json() as Record<string, unknown>;
    const title = normalizeCrmText(body.title, 200);
    const dueAt = normalizeCrmText(body.due_at ?? body.dueAt, 80);
    const linked = body.contact_id || body.contactId || body.enquiry_id || body.enquiryId || body.appointment_id || body.appointmentId || body.deal_id || body.dealId || body.commercial_listing_id || body.commercialListingId || body.listing_reference || body.listingReference;
    if (!title || !dueAt || Number.isNaN(new Date(dueAt).getTime()) || !linked) return crmError(400, 'invalid-follow-up');
    const assignedUserId = auth.role === 'agent' ? auth.user.id : normalizeCrmText(body.assigned_user_id ?? body.assignedUserId, 80) || auth.user.id;
    const result = await auth.supabase.from('crm_follow_ups').insert({
      workspace_id: auth.workspaceId,
      title,
      contact_id: body.contact_id || body.contactId || null,
      enquiry_id: body.enquiry_id || body.enquiryId || null,
      appointment_id: body.appointment_id || body.appointmentId || null,
      deal_id: body.deal_id || body.dealId || null,
      commercial_listing_id: body.commercial_listing_id || body.commercialListingId || null,
      listing_reference: normalizeCrmText(body.listing_reference ?? body.listingReference, 200),
      due_at: new Date(dueAt).toISOString(),
      method: methods.includes(String(body.method)) ? body.method : 'call',
      priority: priorities.includes(String(body.priority)) ? body.priority : 'medium',
      notes: normalizeCrmText(body.notes, 4_000),
      assigned_user_id: assignedUserId,
      created_by: auth.user.id,
    }).select('*').single();
    if (result.error) throw result.error;
    void writeActivity(auth.supabase, auth.workspaceId, 'follow_up', result.data.id, 'follow_up_created', { title, dueAt: result.data.due_at }, auth.user.id);
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
    const current = await auth.supabase.from('crm_follow_ups').select('*').eq('workspace_id', auth.workspaceId).eq('id', id).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) return crmError(404, 'follow-up-not-found');
    if (!canManageCrmRecord(auth.role, current.data.assigned_user_id, auth.user.id)) return crmError(403, 'permission-denied');
    const changes: Record<string, unknown> = {};
    if ('status' in body && statuses.includes(String(body.status))) {
      changes.status = body.status;
      changes.completed_at = body.status === 'completed' ? new Date().toISOString() : null;
    }
    if ('due_at' in body) changes.due_at = new Date(String(body.due_at)).toISOString();
    for (const field of ['title', 'notes']) if (field in body) changes[field] = normalizeCrmText(body[field], field === 'title' ? 200 : 4_000);
    if ('method' in body && methods.includes(String(body.method))) changes.method = body.method;
    if ('priority' in body && priorities.includes(String(body.priority))) changes.priority = body.priority;
    if (!Object.keys(changes).length) return crmError(400, 'no-valid-fields');
    const result = await auth.supabase.from('crm_follow_ups').update(changes).eq('workspace_id', auth.workspaceId).eq('id', id).select('*').single();
    if (result.error) throw result.error;
    void writeActivity(auth.supabase, auth.workspaceId, 'follow_up', id, changes.status === 'completed' ? 'follow_up_completed' : 'crm_updated', { changedFields: Object.keys(changes) }, auth.user.id);
    return NextResponse.json({ success: true, record: result.data });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}
