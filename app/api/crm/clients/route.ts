import { NextResponse } from 'next/server';
import { writeActivity } from '../../../../lib/activity/log';
import { CRM_READ_ROLES, CRM_WRITE_ROLES, crmError, escapePostgrestSearch, protectCrmContact, safePage } from '../../../../lib/crm/api';
import { normalizeCrmEmail, normalizeCrmPhone, normalizeCrmText } from '../../../../lib/crm/normalize';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(CRM_READ_ROLES, request);
    if (auth instanceof Response) return auth;
    const url = new URL(request.url);
    const { page, pageSize, from, to } = safePage(url.searchParams);
    const search = escapePostgrestSearch(url.searchParams.get('q')?.trim() ?? '');
    let query = auth.supabase.from('contacts').select('*', { count:'exact' }).eq('workspace_id', auth.workspaceId).is('archived_at', null).order('updated_at', { ascending:false }).range(from,to);
    if (search) query = query.or(`full_name.ilike.%${search}%,company_name.ilike.%${search}%,phone_original.ilike.%${search}%,email.ilike.%${search}%`);
    const result = await query;
    if (result.error) throw result.error;
    return NextResponse.json({ success:true, rows:(result.data ?? []).map((row) => protectCrmContact(row as Record<string,unknown>, auth.role)), count:result.count ?? 0, page, pageSize, role:auth.role, userId:auth.user.id });
  } catch (error) { return crmError(500, getApiErrorMessage(error)); }
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(CRM_WRITE_ROLES, request);
    if (auth instanceof Response) return auth;
    const body = await request.json() as Record<string,unknown>;
    const fullName = normalizeCrmText(body.full_name ?? body.fullName, 200);
    const companyName = normalizeCrmText(body.company_name ?? body.companyName, 200);
    const phoneOriginal = normalizeCrmText(body.phone_original ?? body.phone, 80);
    const phone = normalizeCrmPhone(phoneOriginal);
    const email = normalizeCrmEmail(body.email);
    if (!fullName && !companyName) return crmError(400, 'client-name-required');
    if (phone || email || fullName || companyName) {
      const filters = [
        phone ? `phone_normalized.eq.${phone}` : '',
        email ? `email.ilike.${email}` : '',
        fullName ? `full_name.ilike.${escapePostgrestSearch(fullName)}` : '',
        companyName ? `company_name.ilike.${escapePostgrestSearch(companyName)}` : '',
      ].filter(Boolean).join(',');
      const duplicate = await auth.supabase.from('contacts').select('id,full_name,company_name,phone_original,email,client_type').eq('workspace_id', auth.workspaceId).or(filters).is('archived_at', null).limit(5);
      if (duplicate.error) throw duplicate.error;
      if (duplicate.data?.length) return crmError(409, 'possible-duplicate-client', { duplicateWarning:true, matches:duplicate.data.map((row) => protectCrmContact(row as Record<string,unknown>, auth.role)) });
    }
    const result = await auth.supabase.from('contacts').insert({
      workspace_id:auth.workspaceId, contact_type:companyName && !fullName ? 'company':'person',
      client_type:['prospect','tenant','buyer','investor','landlord','owner','commercial_tenant','commercial_buyer','company','other'].includes(String(body.client_type)) ? body.client_type : 'prospect',
      nationality:normalizeCrmText(body.nationality,120),
      full_name:fullName, company_name:companyName, phone_original:phoneOriginal, phone_normalized:phone,
      whatsapp_number:normalizeCrmText(body.whatsapp_number,80), email, address:normalizeCrmText(body.address,500),
      preferred_language:['en','zh','bilingual'].includes(String(body.preferred_language)) ? body.preferred_language : 'en',
      source:normalizeCrmText(body.source,120), notes:normalizeCrmText(body.notes,4000),
      assigned_user_id:auth.user.id, created_by:auth.user.id,
    }).select('*').single();
    if (result.error) throw result.error;
    void writeActivity(auth.supabase,auth.workspaceId,'contact',result.data.id,'client_created',{title:fullName || companyName},auth.user.id);
    return NextResponse.json({success:true,record:result.data},{status:201});
  } catch (error) { return crmError(500,getApiErrorMessage(error)); }
}
