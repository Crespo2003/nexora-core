import { NextResponse } from 'next/server';
import { sanitizeCsvText } from '../../../../../lib/commercial/csv';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../../lib/supabase/server';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireWorkspaceAccess(undefined, request);
    if (auth instanceof Response) return auth;
    const proposal = await auth.supabase.from('commercial_proposals').select('id, requirement_id, proposed_date, proposal_language, internal_notes, client_notes, response_date, shortlist_result, status, updated_at').eq('id', params.id).eq('workspace_id', auth.workspaceId).maybeSingle();
    if (proposal.error) throw proposal.error;
    if (!proposal.data) return fail(404, 'proposal-unavailable');
    const [requirement, items, matches] = await Promise.all([
      auth.supabase.from('commercial_requirements').select('id,title,requirement_type,transaction_type,preferred_locations,min_built_up,max_built_up,max_rental,max_purchase_price,company_id,brand_id,status').eq('id', proposal.data.requirement_id).eq('workspace_id', auth.workspaceId).maybeSingle(),
      auth.supabase.from('commercial_proposal_items').select('id,listing_id,match_id,position,client_notes').eq('proposal_id', params.id).eq('workspace_id', auth.workspaceId).is('deleted_at', null).order('position'),
      auth.supabase.from('commercial_matches').select('id,listing_id,overall_score,recommendation_level,matched_criteria,missing_criteria').eq('requirement_id', proposal.data.requirement_id).eq('workspace_id', auth.workspaceId).is('deleted_at', null).order('overall_score', { ascending: false })
    ]);
    if (requirement.error || items.error || matches.error) throw requirement.error || items.error || matches.error;
    const companyId = requirement.data?.company_id; const brandId = requirement.data?.brand_id;
    const [company, brand] = await Promise.all([
      companyId ? auth.supabase.from('commercial_companies').select('id,legal_name,business_category').eq('id', companyId).eq('workspace_id', auth.workspaceId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      brandId ? auth.supabase.from('commercial_brands').select('id,brand_name,business_category').eq('id', brandId).eq('workspace_id', auth.workspaceId).maybeSingle() : Promise.resolve({ data: null, error: null })
    ]);
    if (company.error || brand.error) throw company.error || brand.error;
    const listingIds = Array.from(new Set([...(items.data ?? []).map((row) => row.listing_id), ...(matches.data ?? []).map((row) => row.listing_id)]));
    const safeListings = await loadSafeListings(auth, listingIds);
    const listingMap = new Map(safeListings.map((row) => [String(row.id), row]));
    const matchMap = new Map((matches.data ?? []).map((row) => [String(row.id), row]));
    const selected = (items.data ?? []).map((item) => ({ ...item, listing: listingMap.get(String(item.listing_id)) ?? null, match: item.match_id ? matchMap.get(String(item.match_id)) ?? null : null }));
    const selectedListingIds = new Set(selected.map((item) => String(item.listing_id)));
    const availableMatches = (matches.data ?? []).filter((match) => !selectedListingIds.has(String(match.listing_id))).map((match) => ({ ...match, listing: listingMap.get(String(match.listing_id)) ?? null })).filter((match) => match.listing);
    return NextResponse.json({ success: true, proposal: proposal.data, requirement: requirement.data, company: company.data, brand: brand.data, items: selected, availableMatches, role: auth.role });
  } catch (error) { return fail(500, getApiErrorMessage(error)); }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireWorkspaceAccess(['owner','admin','manager','agent'], request);
    if (auth instanceof Response) return auth;
    const payload = await request.json() as { proposalLanguage?: string; internalNotes?: string; clientNotes?: string; itemOrder?: string[] };
    if (payload.proposalLanguage && !['en','zh','bilingual'].includes(payload.proposalLanguage)) return fail(400, 'invalid-proposal-language');
    const changes: Record<string, unknown> = {};
    if (payload.proposalLanguage) changes.proposal_language = payload.proposalLanguage;
    if (typeof payload.internalNotes === 'string') changes.internal_notes = sanitizeCsvText(payload.internalNotes);
    if (typeof payload.clientNotes === 'string') changes.client_notes = sanitizeCsvText(payload.clientNotes);
    if (Object.keys(changes).length) {
      const proposal = await auth.supabase.from('commercial_proposals').update(changes).eq('id', params.id).eq('workspace_id', auth.workspaceId).select('id').maybeSingle();
      if (proposal.error) throw proposal.error;
      if (!proposal.data) return fail(404, 'proposal-unavailable');
    }
    if (payload.itemOrder) {
      const current = await auth.supabase.from('commercial_proposal_items').select('id').eq('proposal_id', params.id).eq('workspace_id', auth.workspaceId).is('deleted_at', null);
      if (current.error) throw current.error;
      const currentIds = new Set((current.data ?? []).map((item) => String(item.id)));
      if (payload.itemOrder.length !== currentIds.size || payload.itemOrder.some((id) => !currentIds.has(id))) return fail(400, 'invalid-proposal-order');
      for (const [position, id] of payload.itemOrder.entries()) {
        const update = await auth.supabase.from('commercial_proposal_items').update({ position }).eq('id', id).eq('proposal_id', params.id).eq('workspace_id', auth.workspaceId);
        if (update.error) throw update.error;
      }
    }
    return NextResponse.json({ success: true });
  } catch (error) { return fail(500, getApiErrorMessage(error)); }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireWorkspaceAccess(['owner','admin','manager','agent'], request);
    if (auth instanceof Response) return auth;
    const { matchId } = await request.json() as { matchId?: string };
    if (!matchId) return fail(400, 'match-required');
    const proposal = await auth.supabase.from('commercial_proposals').select('id,requirement_id,assigned_user_id').eq('id', params.id).eq('workspace_id', auth.workspaceId).maybeSingle();
    if (proposal.error) throw proposal.error;
    if (!proposal.data) return fail(404, 'proposal-unavailable');
    const match = await auth.supabase.from('commercial_matches').select('id,listing_id').eq('id', matchId).eq('requirement_id', proposal.data.requirement_id).eq('workspace_id', auth.workspaceId).maybeSingle();
    if (match.error) throw match.error;
    if (!match.data) return fail(404, 'match-unavailable');
    const count = await auth.supabase.from('commercial_proposal_items').select('id', { count:'exact', head:true }).eq('proposal_id', params.id).eq('workspace_id', auth.workspaceId).is('deleted_at', null);
    if (count.error) throw count.error;
    if ((count.count ?? 0) >= 5) return fail(409, 'proposal-listing-limit');
    const item = await auth.supabase.from('commercial_proposal_items').insert({ workspace_id: auth.workspaceId, proposal_id: params.id, listing_id: match.data.listing_id, match_id: match.data.id, position: count.count ?? 0, assigned_user_id: proposal.data.assigned_user_id ?? auth.user.id, created_by: auth.user.id }).select('id').single();
    if (item.error) throw item.error;
    return NextResponse.json({ success: true, itemId: item.data.id });
  } catch (error) { return fail(500, getApiErrorMessage(error)); }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireWorkspaceAccess(['owner','admin','manager','agent'], request);
    if (auth instanceof Response) return auth;
    const { itemId } = await request.json() as { itemId?: string };
    if (!itemId) return fail(400, 'proposal-item-required');
    const removed = await auth.supabase.from('commercial_proposal_items').delete().eq('id', itemId).eq('proposal_id', params.id).eq('workspace_id', auth.workspaceId).select('id').maybeSingle();
    if (removed.error) throw removed.error;
    if (!removed.data) return fail(404, 'proposal-item-unavailable');
    return NextResponse.json({ success: true });
  } catch (error) { return fail(500, getApiErrorMessage(error)); }
}

async function loadSafeListings(auth: any, ids: string[]) {
  if (!ids.length) return [];
  const visible = await auth.supabase.from('commercial_listings').select('id,title,property_name,property_type,transaction_type,area,city,built_up,land_area,asking_rental,asking_sale_price,availability_date,status,confidentiality_level,assigned_user_id').in('id', ids).eq('workspace_id', auth.workspaceId).is('deleted_at', null);
  if (visible.error) throw visible.error;
  const visibleIds = new Set((visible.data ?? []).map((row) => String(row.id)));
  const missing = ids.filter((id) => !visibleIds.has(id));
  const summaries: Record<string, unknown>[] = [];
  for (const id of missing) {
    const result = await auth.supabase.rpc('commercial_confidential_listing_summaries', { p_workspace_id: auth.workspaceId, p_listing_id: id });
    if (result.error) throw result.error;
    summaries.push(...(result.data ?? []));
  }
  return [...(visible.data ?? []), ...summaries];
}

function fail(status: number, error: string) { return NextResponse.json({ success:false, error }, { status, headers:{'Cache-Control':'private, no-store'} }); }
