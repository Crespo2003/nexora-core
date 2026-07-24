import { NextResponse } from 'next/server';
import { writeActivity } from '../../../../lib/activity/log';
import { CRM_READ_ROLES, CRM_WRITE_ROLES, crmError, escapePostgrestSearch, safePage } from '../../../../lib/crm/api';
import { normalizeCrmText, normalizeHttpUrl } from '../../../../lib/crm/normalize';
import { canManageCrmRecord } from '../../../../lib/crm/permissions';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const appointmentTypes = ['property_viewing','owner_meeting','tenant_meeting','buyer_meeting','commercial_site_visit','negotiation_meeting','signing','handover','inspection','follow_up','internal_meeting'];
const appointmentStatuses = ['proposed', 'confirmed', 'rescheduled', 'completed', 'cancelled', 'no_show'];

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(CRM_READ_ROLES, request);
    if (auth instanceof Response) return auth;
    const url = new URL(request.url);
    const { page, pageSize, from, to } = safePage(url.searchParams);
    const search = escapePostgrestSearch(url.searchParams.get('q')?.trim() ?? '');
    const status = url.searchParams.get('status');
    const type = url.searchParams.get('type');
    const fromDate = url.searchParams.get('from');
    const toDate = url.searchParams.get('to');
    let query = auth.supabase
      .from('crm_appointments')
      .select('*, contact:contacts(id,full_name,company_name), enquiry:crm_enquiries(id,enquiry_number,stage), deal:crm_deals(id,deal_number,title,stage)', { count: 'exact' })
      .eq('workspace_id', auth.workspaceId)
      .order('start_at', { ascending: true })
      .range(from, to);
    if (status && appointmentStatuses.includes(status)) query = query.eq('status', status);
    if (type && appointmentTypes.includes(type)) query = query.eq('appointment_type', type);
    if (fromDate) query = query.gte('start_at', fromDate);
    if (toDate) query = query.lte('start_at', toDate);
    if (search) query = query.or(`title.ilike.%${search}%,location.ilike.%${search}%,notes.ilike.%${search}%`);
    const assigned = url.searchParams.get('assigned');
    const contact = url.searchParams.get('contact');
    const listing = url.searchParams.get('listing');
    if (assigned === 'me') query = query.eq('assigned_user_id', auth.user.id);
    else if (assigned) query = query.eq('assigned_user_id', assigned);
    if (contact) query = query.eq('contact_id', contact);
    if (listing) query = query.eq('commercial_listing_id', listing);
    const result = await query;
    if (result.error) throw result.error;
    return NextResponse.json({ success: true, rows: result.data ?? [], count: result.count ?? 0, page, pageSize, role: auth.role, userId: auth.user.id });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}

export async function POST(request: Request) {
  try {
    const tooLarge = rejectOversizedRequest(request, 48_000);
    if (tooLarge) return tooLarge;
    const auth = await requireWorkspaceAccess(CRM_WRITE_ROLES, request);
    if (auth instanceof Response) return auth;
    const body = await request.json() as Record<string, unknown>;
    const title = normalizeCrmText(body.title, 200);
    const appointmentType = normalizeCrmText(body.appointment_type ?? body.appointmentType, 40);
    const startAt = normalizeCrmText(body.start_at ?? body.startAt, 80);
    if (!title || !appointmentTypes.includes(appointmentType) || !startAt || Number.isNaN(new Date(startAt).getTime())) {
      return crmError(400, 'invalid-appointment');
    }
    const endAt = normalizeCrmText(body.end_at ?? body.endAt, 80);
    if (endAt && (Number.isNaN(new Date(endAt).getTime()) || new Date(endAt) <= new Date(startAt))) {
      return crmError(400, 'invalid-appointment-time');
    }
    const assignedUserId = auth.role === 'agent' ? auth.user.id : normalizeCrmText(body.assigned_user_id ?? body.assignedUserId, 80) || auth.user.id;
    const result = await auth.supabase.from('crm_appointments').insert({
      workspace_id: auth.workspaceId,
      title,
      appointment_type: appointmentType,
      contact_id: body.contact_id || body.contactId || null,
      enquiry_id: body.enquiry_id || body.enquiryId || null,
      deal_id: body.deal_id || body.dealId || null,
      commercial_listing_id: body.commercial_listing_id || body.commercialListingId || null,
      listing_reference: normalizeCrmText(body.listing_reference ?? body.listingReference, 200),
      location: normalizeCrmText(body.location, 500),
      meeting_point: normalizeCrmText(body.meeting_point ?? body.meetingPoint, 500),
      address: normalizeCrmText(body.address, 1_000),
      map_url: normalizeHttpUrl(body.map_url ?? body.mapUrl),
      start_at: new Date(startAt).toISOString(),
      end_at: endAt ? new Date(endAt).toISOString() : null,
      status: 'proposed',
      reminder_minutes: Math.min(10080, Math.max(0, Number(body.reminder_minutes ?? body.reminderMinutes ?? 60))),
      notes: normalizeCrmText(body.notes, 4_000),
      outcome: normalizeCrmText(body.outcome, 4_000),
      follow_up_at: body.follow_up_at || body.followUpAt || null,
      assigned_user_id: assignedUserId,
      created_by: auth.user.id,
    }).select('*').single();
    if (result.error) throw result.error;
    void writeActivity(auth.supabase, auth.workspaceId, 'appointment', result.data.id, 'appointment_created', { title, startAt: result.data.start_at }, auth.user.id);
    return NextResponse.json({ success: true, record: result.data }, { status: 201 });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}

export async function PATCH(request: Request) {
  try {
    const tooLarge = rejectOversizedRequest(request, 48_000);
    if (tooLarge) return tooLarge;
    const auth = await requireWorkspaceAccess(CRM_WRITE_ROLES, request);
    if (auth instanceof Response) return auth;
    const body = await request.json() as Record<string, unknown>;
    const id = normalizeCrmText(body.id, 80);
    if (!id) return crmError(400, 'record-id-required');
    const current = await auth.supabase.from('crm_appointments').select('*').eq('workspace_id', auth.workspaceId).eq('id', id).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) return crmError(404, 'appointment-not-found');
    if (!canManageCrmRecord(auth.role, current.data.assigned_user_id, auth.user.id)) return crmError(403, 'permission-denied');
    const changes: Record<string, unknown> = {};
    for (const field of ['title', 'location', 'meeting_point', 'address', 'outcome', 'notes', 'listing_reference']) {
      if (field in body) changes[field] = normalizeCrmText(body[field], field === 'title' ? 200 : 4_000);
    }
    if ('map_url' in body) changes.map_url = normalizeHttpUrl(body.map_url);
    if ('appointment_type' in body && appointmentTypes.includes(String(body.appointment_type))) changes.appointment_type = body.appointment_type;
    if ('status' in body && appointmentStatuses.includes(String(body.status))) {
      changes.status = body.status;
      if (body.status === 'completed') changes.completed_at = new Date().toISOString();
      if (body.status === 'cancelled') changes.cancelled_at = new Date().toISOString();
    }
    for (const field of ['contact_id', 'enquiry_id', 'deal_id', 'commercial_listing_id']) if (field in body) changes[field] = body[field] || null;
    for (const field of ['start_at', 'end_at']) if (field in body) changes[field] = body[field] ? new Date(String(body[field])).toISOString() : null;
    if ('follow_up_at' in body) changes.follow_up_at = body.follow_up_at ? new Date(String(body.follow_up_at)).toISOString() : null;
    if ('reminder_minutes' in body) changes.reminder_minutes = Math.min(10080, Math.max(0, Number(body.reminder_minutes)));
    if ('assigned_user_id' in body && auth.role !== 'agent') changes.assigned_user_id = body.assigned_user_id || null;
    if (!Object.keys(changes).length) return crmError(400, 'no-valid-fields');
    const result = await auth.supabase.from('crm_appointments').update(changes).eq('workspace_id', auth.workspaceId).eq('id', id).select('*').single();
    if (result.error) throw result.error;
    void writeActivity(auth.supabase, auth.workspaceId, 'appointment', id, 'appointment_updated', { changedFields: Object.keys(changes), status: changes.status }, auth.user.id);
    return NextResponse.json({ success: true, record: result.data });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}
