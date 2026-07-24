import { NextResponse } from 'next/server';
import { CRM_READ_ROLES, crmError, protectCrmContact } from '../../../../../lib/crm/api';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireWorkspaceAccess(CRM_READ_ROLES, request);
    if (auth instanceof Response) return auth;
    const enquiry = await auth.supabase
      .from('crm_enquiries')
      .select('*, contact:contacts(*)')
      .eq('workspace_id', auth.workspaceId)
      .eq('id', params.id)
      .maybeSingle();
    if (enquiry.error) throw enquiry.error;
    if (!enquiry.data) return crmError(404, 'enquiry-not-found');
    const [matches, appointments, followUps, deals, stages, activities] = await Promise.all([
      auth.supabase.from('crm_listing_matches').select('*').eq('workspace_id', auth.workspaceId).eq('enquiry_id', params.id).order('created_at', { ascending: false }),
      auth.supabase.from('crm_appointments').select('*').eq('workspace_id', auth.workspaceId).eq('enquiry_id', params.id).order('start_at', { ascending: true }),
      auth.supabase.from('crm_follow_ups').select('*').eq('workspace_id', auth.workspaceId).eq('enquiry_id', params.id).order('due_at', { ascending: true }),
      auth.supabase.from('crm_deals').select('*').eq('workspace_id', auth.workspaceId).eq('enquiry_id', params.id).order('updated_at', { ascending: false }),
      auth.supabase.from('crm_enquiry_stage_history').select('*').eq('workspace_id', auth.workspaceId).eq('enquiry_id', params.id).order('created_at', { ascending: false }),
      auth.supabase.from('activity_logs').select('*').eq('workspace_id', auth.workspaceId).eq('entity_type', 'enquiry').eq('entity_id', params.id).order('created_at', { ascending: false }).limit(100),
    ]);
    const failed = [matches, appointments, followUps, deals, stages, activities].find((result) => result.error);
    if (failed?.error) throw failed.error;
    const record = enquiry.data as Record<string, unknown>;
    return NextResponse.json({
      success: true,
      record: { ...record, contact: protectCrmContact(record.contact as Record<string, unknown>, auth.role) },
      matches: matches.data ?? [],
      appointments: appointments.data ?? [],
      followUps: followUps.data ?? [],
      deals: deals.data ?? [],
      stages: stages.data ?? [],
      activities: activities.data ?? [],
      role: auth.role,
      userId: auth.user.id,
    });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}
