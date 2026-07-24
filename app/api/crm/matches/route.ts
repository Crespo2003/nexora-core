import { NextResponse } from 'next/server';
import { CRM_WRITE_ROLES, crmError } from '../../../../lib/crm/api';
import { normalizeCrmText, nullableNumber } from '../../../../lib/crm/normalize';
import { canManageCrmRecord } from '../../../../lib/crm/permissions';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(CRM_WRITE_ROLES, request);
    if (auth instanceof Response) return auth;
    const body = await request.json() as Record<string, unknown>;
    const enquiryId = normalizeCrmText(body.enquiryId ?? body.enquiry_id, 80);
    const enquiry = await auth.supabase.from('crm_enquiries').select('assigned_user_id').eq('workspace_id', auth.workspaceId).eq('id', enquiryId).maybeSingle();
    if (enquiry.error) throw enquiry.error;
    if (!enquiry.data) return crmError(404, 'enquiry-not-found');
    if (!canManageCrmRecord(auth.role, enquiry.data.assigned_user_id, auth.user.id)) return crmError(403, 'permission-denied');
    const commercialListingId = body.commercialListingId || body.commercial_listing_id || null;
    const listingReference = normalizeCrmText(body.listingReference ?? body.listing_reference, 200);
    if (!commercialListingId && !listingReference) return crmError(400, 'listing-required');
    const result = await auth.supabase.from('crm_listing_matches').insert({
      workspace_id: auth.workspaceId,
      enquiry_id: enquiryId,
      commercial_listing_id: commercialListingId,
      listing_reference: listingReference,
      listing_title: normalizeCrmText(body.listingTitle ?? body.listing_title, 200),
      match_score: nullableNumber(body.matchScore ?? body.match_score),
      match_status: ['suggested','sent_to_client','interested','not_interested','viewing_requested','shortlisted','rejected'].includes(String(body.matchStatus ?? body.match_status)) ? body.matchStatus ?? body.match_status : 'suggested',
      client_response: normalizeCrmText(body.clientResponse ?? body.client_response, 2_000),
      notes: normalizeCrmText(body.notes, 2_000),
      assigned_user_id: enquiry.data.assigned_user_id,
      created_by: auth.user.id,
    }).select('*').single();
    if (result.error) throw result.error;
    return NextResponse.json({ success: true, record: result.data }, { status: 201 });
  } catch (error) {
    return crmError(500, getApiErrorMessage(error));
  }
}
