import { NextResponse } from 'next/server';
import { requireWorkspaceAccess } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireWorkspaceAccess();
  if (auth instanceof Response) return auth;
  const { supabase, workspaceId } = auth;

  const today = new Date().toISOString().slice(0, 10);
  const in30Days = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const in60Days = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);

  const [tenancySettled, collectionSettled, activitySettled, appointmentSettled, followUpSettled, inactiveEnquirySettled, hotLeadSettled, crmActivitySettled] = await Promise.allSettled([
    supabase
      .from('tenancies')
      .select('id, tenant, property, unit_no, expiry_date, status')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .lte('expiry_date', in60Days)
      .gte('expiry_date', today)
      .order('expiry_date', { ascending: true })
      .limit(20),
    supabase
      .from('rental_collections')
      .select('id, tenancy_id, outstanding_balance, due_date')
      .eq('workspace_id', workspaceId)
      .gt('outstanding_balance', 0)
      .lt('due_date', today)
      .order('due_date', { ascending: true })
      .limit(20),
    supabase
      .from('activity_logs')
      .select('id, entity_type, activity_type, activity_json, created_at')
      .eq('workspace_id', workspaceId)
      .eq('activity_type', 'document_uploaded')
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('crm_appointments')
      .select('id,title,start_at,status,location')
      .eq('workspace_id', workspaceId)
      .in('status', ['proposed','confirmed','rescheduled'])
      .gte('start_at', new Date().toISOString())
      .lte('start_at', new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
      .order('start_at')
      .limit(20),
    supabase
      .from('crm_follow_ups')
      .select('id,title,due_at,priority,enquiry_id,deal_id')
      .eq('workspace_id', workspaceId)
      .eq('status', 'pending')
      .lte('due_at', new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString())
      .order('due_at')
      .limit(20),
    supabase
      .from('crm_enquiries')
      .select('id,enquiry_number,stage,updated_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .is('archived_at', null)
      .lt('updated_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order('updated_at')
      .limit(12),
    supabase
      .from('crm_enquiries')
      .select('id,enquiry_number,stage,priority,updated_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .eq('priority', 'hot')
      .is('next_follow_up_at', null)
      .is('archived_at', null)
      .limit(12),
    supabase
      .from('activity_logs')
      .select('id,entity_type,entity_id,activity_type,activity_json,created_at')
      .eq('workspace_id', workspaceId)
      .in('activity_type', ['appointment_updated','deal_stage_changed'])
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order('created_at', { ascending: false })
      .limit(20),
  ]);
  const tenancyResult = tenancySettled.status === 'fulfilled' ? tenancySettled.value : { data: [] };
  const collectionResult = collectionSettled.status === 'fulfilled' ? collectionSettled.value : { data: [] };
  const activityResult = activitySettled.status === 'fulfilled' ? activitySettled.value : { data: [] };
  const appointmentResult = appointmentSettled.status === 'fulfilled' ? appointmentSettled.value : { data: [] };
  const followUpResult = followUpSettled.status === 'fulfilled' ? followUpSettled.value : { data: [] };
  const inactiveEnquiryResult = inactiveEnquirySettled.status === 'fulfilled' ? inactiveEnquirySettled.value : { data: [] };
  const hotLeadResult = hotLeadSettled.status === 'fulfilled' ? hotLeadSettled.value : { data: [] };
  const crmActivityResult = crmActivitySettled.status === 'fulfilled' ? crmActivitySettled.value : { data: [] };

  const notifications: Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    title_zh?: string;
    body_zh?: string;
    entity_type: string;
    entity_id: string;
    created_at: string;
  }> = [];

  (tenancyResult.data ?? []).forEach((t) => {
    const daysLeft = Math.ceil(
      (new Date(t.expiry_date).getTime() - new Date(today).getTime()) / 86_400_000
    );
    const urgent = daysLeft <= 30;
    notifications.push({
      id: `renewal-${t.id}`,
      type: 'renewal',
      title: urgent
        ? `Renewal urgent — ${t.tenant}`
        : `Renewal in ${daysLeft} days — ${t.tenant}`,
      body: `${t.property}${t.unit_no ? ' ' + t.unit_no : ''} expires ${t.expiry_date}`,
      entity_type: 'tenancy',
      entity_id: t.id,
      created_at: t.expiry_date,
    });
  });

  (collectionResult.data ?? []).forEach((c) => {
    notifications.push({
      id: `outstanding-${c.id}`,
      type: 'outstanding',
      title: `Outstanding rental overdue`,
      body: `RM ${Number(c.outstanding_balance).toFixed(2)} due ${c.due_date}`,
      entity_type: 'collection',
      entity_id: c.id,
      created_at: c.due_date,
    });
  });

  (activityResult.data ?? []).forEach((a) => {
    const json = (a.activity_json ?? {}) as Record<string, unknown>;
    notifications.push({
      id: `doc-${a.id}`,
      type: 'document_upload',
      title: 'Document uploaded',
      body: String(json.filename ?? 'New document'),
      entity_type: a.entity_type,
      entity_id: String(a.entity_type),
      created_at: a.created_at,
    });
  });

  (appointmentResult.data ?? []).forEach((appointment) => {
    const withinOneHour = new Date(appointment.start_at).getTime() - Date.now() <= 60 * 60 * 1000;
    notifications.push({
      id: `crm-appointment-${appointment.id}`,
      type: 'crm_appointment',
      title: `${withinOneHour ? 'Appointment in 1 hour' : 'Appointment today'} — ${appointment.title}`,
      title_zh: `${withinOneHour ? '预约将在 1 小时内开始' : '今日预约'} — ${appointment.title}`,
      body: `${appointment.location || 'Location not set'} · ${appointment.start_at}`,
      body_zh: `${appointment.location || '未设置地点'} · ${appointment.start_at}`,
      entity_type: 'appointment',
      entity_id: appointment.id,
      created_at: appointment.start_at,
    });
  });

  (followUpResult.data ?? []).forEach((followUp) => {
    const overdue = new Date(followUp.due_at).getTime() < Date.now();
    notifications.push({
      id: `crm-follow-up-${followUp.id}`,
      type: 'crm_reminder',
      title: `${overdue ? 'Overdue' : 'Due soon'} — ${followUp.title}`,
      title_zh: `${overdue ? '已逾期' : '即将到期'} — ${followUp.title}`,
      body: `${followUp.priority} priority follow-up`,
      body_zh: `${followUp.priority} 优先级跟进`,
      entity_type: 'follow_up',
      entity_id: followUp.id,
      created_at: followUp.due_at,
    });
  });

  (inactiveEnquiryResult.data ?? []).forEach((enquiry) => {
    notifications.push({
      id: `crm-inactive-${enquiry.id}`,
      type: 'crm_inactive',
      title: `Enquiry needs attention — ${enquiry.enquiry_number}`,
      title_zh: `询盘需要跟进 — ${enquiry.enquiry_number}`,
      body: `No activity for 7 days · ${String(enquiry.stage).replaceAll('_', ' ')}`,
      body_zh: `已有 7 天无活动 · ${String(enquiry.stage).replaceAll('_', ' ')}`,
      entity_type: 'enquiry',
      entity_id: enquiry.id,
      created_at: enquiry.updated_at,
    });
  });

  (hotLeadResult.data ?? []).forEach((enquiry) => {
    notifications.push({
      id: `crm-hot-no-follow-up-${enquiry.id}`,
      type: 'crm_hot_lead',
      title: `Hot lead has no follow-up — ${enquiry.enquiry_number}`,
      title_zh: `热门客户尚未安排跟进 — ${enquiry.enquiry_number}`,
      body: `Assign a next action while the enquiry is active.`,
      body_zh: `请为活跃询盘安排下一步行动。`,
      entity_type: 'enquiry',
      entity_id: enquiry.id,
      created_at: enquiry.updated_at,
    });
  });

  (crmActivityResult.data ?? []).forEach((activity) => {
    const json = (activity.activity_json ?? {}) as Record<string, unknown>;
    const isDeal = activity.activity_type === 'deal_stage_changed';
    const isRescheduled = json.status === 'rescheduled';
    notifications.push({
      id: `crm-activity-${activity.id}`,
      type: isDeal ? 'crm_deal_stage' : 'crm_rescheduled',
      title: isDeal ? 'Deal stage changed' : isRescheduled ? 'Viewing rescheduled' : 'Viewing or appointment updated',
      title_zh: isDeal ? '交易阶段已变更' : isRescheduled ? '看房已改期' : '看房或预约已更新',
      body: isDeal
        ? `${String(json.fromStage ?? '')} → ${String(json.toStage ?? '')}`
        : String(json.status ?? 'Schedule details changed'),
      body_zh: isDeal
        ? `${String(json.fromStage ?? '')} → ${String(json.toStage ?? '')}`
        : String(json.status ?? '日程详情已更改'),
      entity_type: activity.entity_type,
      entity_id: String(activity.entity_id ?? ''),
      created_at: activity.created_at,
    });
  });

  notifications.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return NextResponse.json({
    success: true,
    notifications: notifications.slice(0, 30),
    unreadCount: notifications.length,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireWorkspaceAccess();
  if (auth instanceof Response) return auth;
  const { supabase, workspaceId } = auth;

  const body = await request.json() as { ids?: string[] };
  if (!body.ids?.length) {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('workspace_id', workspaceId)
      .eq('is_read', false);
  } else {
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('workspace_id', workspaceId)
      .in('id', body.ids);
  }

  return NextResponse.json({ success: true });
}
