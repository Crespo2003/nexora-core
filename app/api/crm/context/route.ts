import { NextResponse } from 'next/server';
import { CRM_READ_ROLES, crmError, protectCrmContact } from '../../../../lib/crm/api';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(CRM_READ_ROLES, request);
    if (auth instanceof Response) return auth;
    const [members, contacts, enquiries, deals, listings] = await Promise.all([
      auth.supabase.from('workspace_members').select('user_id,role,profiles:user_id(full_name,email)').eq('workspace_id', auth.workspaceId).eq('status', 'active').order('created_at'),
      auth.supabase.from('contacts').select('id,full_name,company_name,phone_original,email,client_type,assigned_user_id').eq('workspace_id', auth.workspaceId).is('archived_at', null).order('updated_at', { ascending: false }).limit(250),
      auth.supabase.from('crm_enquiries').select('id,enquiry_number,contact_id,transaction_type,stage').eq('workspace_id', auth.workspaceId).is('archived_at', null).order('updated_at', { ascending: false }).limit(250),
      auth.supabase.from('crm_deals').select('id,deal_number,title,contact_id,enquiry_id,stage').eq('workspace_id', auth.workspaceId).is('archived_at', null).order('updated_at', { ascending: false }).limit(250),
      auth.supabase.from('commercial_listings').select('id,title,property_name,area,status').eq('workspace_id', auth.workspaceId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(250),
    ]);
    const failed = [members, contacts, enquiries, deals, listings].find((result) => result.error);
    if (failed?.error) throw failed.error;
    return NextResponse.json({
      success: true,
      members: members.data ?? [],
      contacts: (contacts.data ?? []).map((row) => protectCrmContact(row as Record<string, unknown>, auth.role)),
      enquiries: enquiries.data ?? [],
      deals: deals.data ?? [],
      listings: listings.data ?? [],
      role: auth.role,
      userId: auth.user.id,
    });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}
