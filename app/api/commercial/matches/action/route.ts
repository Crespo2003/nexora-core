import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../../lib/supabase/server';

type MatchAction = 'shortlist' | 'reject' | 'feedback' | 'deal' | 'viewing' | 'proposal';

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    const payload = await request.json() as { matchId?: string; action?: MatchAction; reason?: string; feedback?: string };
    if (!payload.matchId || !payload.action) return NextResponse.json({ success: false, error: 'match-action-required' }, { status: 400 });
    const match = await auth.supabase.from('commercial_matches').select('*, commercial_listings(title)').eq('id', payload.matchId).eq('workspace_id', auth.workspaceId).maybeSingle();
    if (match.error) throw match.error;
    if (!match.data) return NextResponse.json({ success: false, error: 'match-not-found' }, { status: 404 });
    const row = match.data as Record<string, unknown>;
    if (payload.action === 'shortlist' || payload.action === 'reject' || payload.action === 'feedback') {
      const changes = payload.action === 'shortlist' ? { shortlist_status: 'shortlisted', rejection_reason: '' }
        : payload.action === 'reject' ? { shortlist_status: 'rejected', rejection_reason: payload.reason || 'Not suitable' }
        : { feedback: payload.feedback || '' };
      const updated = await auth.supabase.from('commercial_matches').update(changes).eq('id', payload.matchId).eq('workspace_id', auth.workspaceId).select('id').maybeSingle();
      if (updated.error) throw updated.error;
      return NextResponse.json({ success: true, action: payload.action, recordId: payload.matchId });
    }
    if (payload.action === 'deal') {
      const listing = row.commercial_listings as { title?: string } | null;
      const created = await auth.supabase.from('commercial_deals').insert({ workspace_id: auth.workspaceId, title: listing?.title ? `Deal - ${listing.title}` : 'Commercial match deal', requirement_id: row.requirement_id, listing_id: row.listing_id, assigned_user_id: row.assigned_user_id ?? auth.user.id, created_by: auth.user.id }).select('id').single();
      if (created.error) throw created.error;
      return NextResponse.json({ success: true, action: payload.action, recordId: created.data.id });
    }
    if (payload.action === 'viewing') {
      const created = await auth.supabase.from('commercial_viewings').insert({ workspace_id: auth.workspaceId, requirement_id: row.requirement_id, listing_id: row.listing_id, viewing_date: new Date().toISOString(), viewing_status: 'proposed', assigned_user_id: row.assigned_user_id ?? auth.user.id, created_by: auth.user.id }).select('id').single();
      if (created.error) throw created.error;
      return NextResponse.json({ success: true, action: payload.action, recordId: created.data.id });
    }
    const proposal = await auth.supabase.from('commercial_proposals').insert({ workspace_id: auth.workspaceId, requirement_id: row.requirement_id, proposal_language: 'bilingual', status: 'draft', assigned_user_id: row.assigned_user_id ?? auth.user.id, created_by: auth.user.id }).select('id').single();
    if (proposal.error) throw proposal.error;
    const item = await auth.supabase.from('commercial_proposal_items').insert({ workspace_id: auth.workspaceId, proposal_id: proposal.data.id, listing_id: row.listing_id, match_id: payload.matchId, position: 1, assigned_user_id: row.assigned_user_id ?? auth.user.id, created_by: auth.user.id });
    if (item.error) {
      await auth.supabase.from('commercial_proposals').delete().eq('id', proposal.data.id).eq('workspace_id', auth.workspaceId);
      throw item.error;
    }
    return NextResponse.json({ success: true, action: payload.action, recordId: proposal.data.id });
  } catch (error) {
    return NextResponse.json({ success: false, error: getApiErrorMessage(error) }, { status: 500 });
  }
}
