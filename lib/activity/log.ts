import type { SupabaseClient } from '@supabase/supabase-js';

export type ActivityType =
  | 'tenancy_created' | 'tenancy_updated' | 'tenancy_deleted'
  | 'payment_recorded' | 'document_uploaded' | 'document_deleted'
  | 'reminder_sent' | 'crm_updated' | 'collection_generated'
  | 'workspace_provisioned' | 'workspace_invitation_created' | 'workspace_invitation_accepted';

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
