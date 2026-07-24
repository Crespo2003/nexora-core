import type { SupabaseClient } from '@supabase/supabase-js';

export type ActivityType =
  | 'tenancy_created' | 'tenancy_updated' | 'tenancy_deleted'
  | 'payment_recorded' | 'document_uploaded' | 'document_deleted'
  | 'reminder_sent' | 'crm_updated' | 'collection_generated'
  | 'workspace_provisioned' | 'workspace_invitation_created' | 'workspace_invitation_accepted'
  | 'enquiry_created' | 'enquiry_stage_changed' | 'enquiry_archived'
  | 'client_created' | 'appointment_created' | 'appointment_updated'
  | 'follow_up_created' | 'follow_up_completed' | 'deal_created' | 'deal_stage_changed';

export async function writeActivity(
  supabase: SupabaseClient,
  workspaceId: string,
  entityType: string,
  entityId: string | null,
  activityType: ActivityType,
  activityJson: Record<string, unknown> = {},
  createdBy = ''
): Promise<void> {
  await supabase.from('activity_logs').insert({
    workspace_id: workspaceId,
    entity_type: entityType,
    entity_id: entityId ?? undefined,
    activity_type: activityType,
    activity_json: activityJson,
    created_by: createdBy,
  });
}
