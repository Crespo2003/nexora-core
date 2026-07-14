import { NextResponse } from 'next/server';
import { calculateDaysRemaining } from '../../../../lib/tenancy-workspace/core';
import type { TenancySearchResult } from '../../../../lib/tenancy-workspace/types';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess();
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId } = auth;
    const url = new URL(request.url);
    const query = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
    const filter = url.searchParams.get('filter') ?? 'all';

    const [tenanciesResult, collectionsResult, accountsResult, billsResult, linksResult, documentsResult] = await Promise.all([
      supabase.from('tenancies').select('*').eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).limit(500),
      supabase.from('rental_collections').select('tenancy_id, outstanding_balance, payment_status').eq('workspace_id', workspaceId),
      supabase.from('utility_accounts').select('tenancy_id, account_number, account_number_masked').eq('workspace_id', workspaceId),
      supabase.from('utility_bills').select('tenancy_id, bill_number, provider').eq('workspace_id', workspaceId),
      supabase.from('document_links').select('document_id, entity_id').eq('workspace_id', workspaceId).eq('entity_type', 'tenancy'),
      supabase.from('documents').select('id, original_filename').eq('workspace_id', workspaceId)
    ]);
    for (const result of [tenanciesResult, collectionsResult, accountsResult, billsResult, linksResult, documentsResult]) {
      if (result.error) throw result.error;
    }

    const collections = collectionsResult.data ?? [];
    const accounts = accountsResult.data ?? [];
    const bills = billsResult.data ?? [];
    const filenames = new Map((documentsResult.data ?? []).map((document) => [String(document.id), String(document.original_filename)]));
    const documentsByTenancy = new Map<string, string[]>();
    for (const link of linksResult.data ?? []) {
      const items = documentsByTenancy.get(String(link.entity_id)) ?? [];
      items.push(filenames.get(String(link.document_id)) ?? '');
      documentsByTenancy.set(String(link.entity_id), items);
    }

    const results: TenancySearchResult[] = [];
    for (const tenancy of tenanciesResult.data ?? []) {
      const tenancyId = String(tenancy.id);
      const tenancyCollections = collections.filter((row) => row.tenancy_id === tenancy.id);
      const outstanding = tenancyCollections.reduce((sum, row) => sum + Number(row.outstanding_balance ?? 0), 0);
      const searchText = [
        tenancy.tenant, tenancy.landlord, tenancy.tenant_id_no, tenancy.tenant_phone,
        tenancy.property, tenancy.unit_no,
        ...accounts.filter((account) => account.tenancy_id === tenancy.id).flatMap((account) => [account.account_number, account.account_number_masked]),
        ...bills.filter((bill) => bill.tenancy_id === tenancy.id).flatMap((bill) => [bill.bill_number, bill.provider]),
        ...(documentsByTenancy.get(tenancyId) ?? [])
      ].join(' ').toLowerCase();
      if (query && !searchText.includes(query)) continue;

      const days = calculateDaysRemaining(String(tenancy.expiry_date));
      const renewalDays = tenancy.renewal_reminder ? calculateDaysRemaining(String(tenancy.renewal_reminder)) : Number.POSITIVE_INFINITY;
      const matchesFilter =
        filter === 'all' ||
        (filter === 'expiring' && days >= 0 && days <= 90) ||
        (filter === 'overdue' && tenancyCollections.some((row) => row.payment_status === 'overdue')) ||
        (filter === 'vacant' && tenancy.occupancy_status === 'vacant') ||
        (filter === 'occupied' && tenancy.occupancy_status !== 'vacant') ||
        (filter === 'outstanding' && outstanding > 0) ||
        (filter === 'renewal' && renewalDays >= 0 && renewalDays <= 90);
      if (!matchesFilter) continue;

      results.push({
        id: tenancyId,
        tenant: String(tenancy.tenant ?? ''),
        landlord: String(tenancy.landlord ?? ''),
        property: String(tenancy.property ?? ''),
        unitNo: String(tenancy.unit_no ?? ''),
        occupancyStatus: tenancy.occupancy_status === 'vacant' ? 'vacant' : 'occupied',
        status: String(tenancy.status ?? ''),
        expiryDate: String(tenancy.expiry_date ?? ''),
        outstanding
      });
    }

    return NextResponse.json({ results: results.slice(0, 30) }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' }
    });
  } catch (error) {
    return NextResponse.json({ error: getApiErrorMessage(error) }, { status: 500 });
  }
}
