import { NextResponse } from 'next/server';
import { commercialResources } from '../../../../lib/commercial/resources';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const searchable = ['companies', 'brands', 'contacts', 'requirements', 'listings', 'deals'] as const;

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(undefined, request);
    if (auth instanceof Response) return auth;
    const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
    if (query.length < 2) return NextResponse.json({ success: true, rows: [], role: auth.role });
    const safe = query.replace(/[,%()]/g, ' ');
    const results = await Promise.all(searchable.map(async (resource) => {
      const config = commercialResources[resource];
      const response = await auth.supabase.from(config.table).select('*').eq('workspace_id', auth.workspaceId).is('deleted_at', null).or(config.search.map((field) => `${field}.ilike.%${safe}%`).join(',')).limit(20);
      if (response.error) throw response.error;
      return (response.data ?? []).map((row) => ({ ...row, _resource: resource }));
    }));
    const summaries = await auth.supabase.rpc('commercial_confidential_listing_summaries', { p_workspace_id: auth.workspaceId, p_listing_id: null });
    if (summaries.error) throw summaries.error;
    const summaryRows = ((summaries.data ?? []) as Record<string, unknown>[]).filter((row) => ['area','property_type','transaction_type','availability_status'].some((key) => String(row[key] ?? '').toLowerCase().includes(safe.toLowerCase()))).map((row) => ({ ...row, _resource: 'listings' }));
    return NextResponse.json({ success: true, rows: [...results.flat(), ...summaryRows], role: auth.role });
  } catch (error) {
    return NextResponse.json({ success: false, error: getApiErrorMessage(error) }, { status: 500 });
  }
}
