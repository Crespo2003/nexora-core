import { NextResponse } from 'next/server';
import { writeActivity } from '../../../../../lib/activity/log';
import { CRM_READ_ROLES, CRM_WRITE_ROLES, crmError, protectCrmContact } from '../../../../../lib/crm/api';
import { normalizeCrmEmail, normalizeCrmPhone, normalizeCrmText } from '../../../../../lib/crm/normalize';
import { canManageCrmRecord } from '../../../../../lib/crm/permissions';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireWorkspaceAccess(CRM_READ_ROLES, request);
    if (auth instanceof Response) return auth;
    const contact = await auth.supabase.from('contacts').select('*').eq('workspace_id', auth.workspaceId).eq('id', params.id).maybeSingle();
    if (contact.error) throw contact.error;
    if (!contact.data) return crmError(404, 'client-not-found');
    const [enquiries, appointments, deals, followUps, activity] = await Promise.all([
      auth.supabase.from('crm_enquiries').select('id,enquiry_number,transaction_type,stage,priority,updated_at').eq('workspace_id', auth.workspaceId).eq('contact_id', params.id).order('updated_at', { ascending: false }),
      auth.supabase.from('crm_appointments').select('id,title,appointment_type,start_at,status,location').eq('workspace_id', auth.workspaceId).eq('contact_id', params.id).order('start_at', { ascending: false }).limit(100),
      auth.supabase.from('crm_deals').select('id,deal_number,title,transaction_type,stage,deal_value,updated_at').eq('workspace_id', auth.workspaceId).eq('contact_id', params.id).order('updated_at', { ascending: false }),
      auth.supabase.from('crm_follow_ups').select('id,title,due_at,status,priority').eq('workspace_id', auth.workspaceId).eq('contact_id', params.id).order('due_at', { ascending: false }),
      auth.supabase.from('activity_logs').select('*').eq('workspace_id', auth.workspaceId).eq('entity_type', 'contact').eq('entity_id', params.id).order('created_at', { ascending: false }).limit(100),
    ]);
    const failed = [enquiries, appointments, deals, followUps, activity].find((result) => result.error);
    if (failed?.error) throw failed.error;
    return NextResponse.json({
      success: true,
      record: protectCrmContact(contact.data as Record<string, unknown>, auth.role),
      enquiries: enquiries.data ?? [], appointments: appointments.data ?? [], deals: deals.data ?? [],
      followUps: followUps.data ?? [], activities: activity.data ?? [], role: auth.role, userId: auth.user.id,
    });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireWorkspaceAccess(CRM_WRITE_ROLES, request);
    if (auth instanceof Response) return auth;
    const current = await auth.supabase.from('contacts').select('*').eq('workspace_id', auth.workspaceId).eq('id', params.id).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) return crmError(404, 'client-not-found');
    if (!canManageCrmRecord(auth.role, current.data.assigned_user_id, auth.user.id)) return crmError(403, 'permission-denied');
    const body = await request.json() as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    for (const field of ['full_name','company_name','nationality','address','source','notes']) if (field in body) changes[field] = normalizeCrmText(body[field], field === 'notes' ? 4_000 : 500);
    if ('phone_original' in body) { changes.phone_original = normalizeCrmText(body.phone_original, 80); changes.phone_normalized = normalizeCrmPhone(body.phone_original); }
    if ('email' in body) changes.email = normalizeCrmEmail(body.email);
    if ('whatsapp_number' in body) changes.whatsapp_number = normalizeCrmText(body.whatsapp_number, 80);
    if ('client_type' in body && ['prospect','tenant','buyer','investor','landlord','owner','commercial_tenant','commercial_buyer','company','other'].includes(String(body.client_type))) changes.client_type = body.client_type;
    if ('preferred_language' in body && ['en','zh','bilingual'].includes(String(body.preferred_language))) changes.preferred_language = body.preferred_language;
    if (body.action === 'archive') changes.archived_at = new Date().toISOString();
    if (!Object.keys(changes).length) return crmError(400, 'no-valid-fields');
    const result = await auth.supabase.from('contacts').update(changes).eq('workspace_id', auth.workspaceId).eq('id', params.id).select('*').single();
    if (result.error) throw result.error;
    void writeActivity(auth.supabase, auth.workspaceId, 'contact', params.id, 'crm_updated', { changedFields: Object.keys(changes) }, auth.user.id);
    return NextResponse.json({ success: true, record: result.data });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}
