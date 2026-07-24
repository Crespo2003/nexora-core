import { NextResponse } from 'next/server';
import { CRM_READ_ROLES, crmError } from '../../../../lib/crm/api';
import { CRM_PIPELINE_STAGES } from '../../../../lib/crm/pipeline';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(CRM_READ_ROLES, request);
    if (auth instanceof Response) return auth;
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    const inSevenDays = new Date(now.getTime() + 7 * 86_400_000).toISOString();
    const [enquiries, appointments, followUps, deals, activity] = await Promise.allSettled([
      auth.supabase.from('crm_enquiries').select('id,stage,priority,next_follow_up_at,created_at', { count: 'exact' }).eq('workspace_id', auth.workspaceId).is('archived_at', null),
      auth.supabase.from('crm_appointments').select('id,title,appointment_type,start_at,status,location,contact:contacts(full_name,company_name)').eq('workspace_id', auth.workspaceId).gte('start_at', todayStart).lte('start_at', inSevenDays).in('status', ['proposed','confirmed','rescheduled']).order('start_at').limit(8),
      auth.supabase.from('crm_follow_ups').select('id,title,due_at,priority,status,enquiry_id,deal_id').eq('workspace_id', auth.workspaceId).eq('status', 'pending').lte('due_at', tomorrow).order('due_at').limit(12),
      auth.supabase.from('crm_deals').select('id,title,stage,deal_value,probability,updated_at').eq('workspace_id', auth.workspaceId).eq('status', 'active').is('archived_at', null).order('updated_at', { ascending: false }).limit(100),
      auth.supabase.from('activity_logs').select('id,entity_type,entity_id,activity_type,activity_json,created_at').eq('workspace_id', auth.workspaceId).in('entity_type', ['enquiry','appointment','deal','follow_up','contact']).order('created_at', { ascending: false }).limit(12),
    ]);
    const enquiryRows = enquiries.status === 'fulfilled' ? enquiries.value.data ?? [] : [];
    const dealRows = deals.status === 'fulfilled' ? deals.value.data ?? [] : [];
    const pipeline = Object.fromEntries(CRM_PIPELINE_STAGES.map((stage) => [stage, dealRows.filter((deal) => deal.stage === stage).length]));
    const activeValue = dealRows.reduce((sum, deal) => sum + Number(deal.deal_value ?? 0), 0);
    return NextResponse.json({
      success: true,
      metrics: {
        activeEnquiries: enquiryRows.length,
        newEnquiriesToday: enquiryRows.filter((row) => row.created_at >= todayStart).length,
        hotLeads: enquiryRows.filter((row) => row.priority === 'hot').length,
        followUpsDueToday: followUps.status === 'fulfilled' ? (followUps.value.data ?? []).length : 0,
        viewingsToday: appointments.status === 'fulfilled' ? (appointments.value.data ?? []).filter((row) => row.appointment_type === 'property_viewing' && row.start_at < tomorrow).length : 0,
        activeDeals: dealRows.length,
        activeDealValue: activeValue,
      },
      pipeline,
      deals: dealRows.slice(0, 8),
      appointments: appointments.status === 'fulfilled' ? appointments.value.data ?? [] : [],
      urgent: followUps.status === 'fulfilled' ? followUps.value.data ?? [] : [],
      recentActivity: activity.status === 'fulfilled' ? activity.value.data ?? [] : [],
      partialErrors: {
        enquiries: enquiries.status === 'rejected' || Boolean(enquiries.status === 'fulfilled' && enquiries.value.error),
        appointments: appointments.status === 'rejected' || Boolean(appointments.status === 'fulfilled' && appointments.value.error),
        followUps: followUps.status === 'rejected' || Boolean(followUps.status === 'fulfilled' && followUps.value.error),
        deals: deals.status === 'rejected' || Boolean(deals.status === 'fulfilled' && deals.value.error),
        activity: activity.status === 'rejected' || Boolean(activity.status === 'fulfilled' && activity.value.error),
      },
    });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}
