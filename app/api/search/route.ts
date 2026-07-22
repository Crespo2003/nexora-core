import { NextResponse } from 'next/server';
import { requireWorkspaceAccess } from '../../../lib/supabase/server';

export async function GET(request: Request) {
  const auth = await requireWorkspaceAccess();
  if (auth instanceof Response) return auth;
  const { supabase, workspaceId } = auth;

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';

  if (q.length < 2) {
    return NextResponse.json({ success: true, groups: [] });
  }

  const pattern = `%${q}%`;

  const [tenancyResult, documentResult, commercialResult] = await Promise.allSettled([
    supabase
      .from('tenancies')
      .select('id, tenant, landlord, property, unit_no, status')
      .eq('workspace_id', workspaceId)
      .or(`tenant.ilike.${pattern},landlord.ilike.${pattern},property.ilike.${pattern},unit_no.ilike.${pattern}`)
      .limit(8),
    supabase
      .from('documents')
      .select('id, original_filename, document_type, processing_status')
      .eq('workspace_id', workspaceId)
      .ilike('original_filename', pattern)
      .limit(6),
    supabase
      .from('commercial_requirements')
      .select('id, title, requirement_type, status')
      .eq('workspace_id', workspaceId)
      .ilike('title', pattern)
      .limit(6),
  ]);

  const groups = [];

  const tenancies = tenancyResult.status === 'fulfilled' ? (tenancyResult.value.data ?? []) : [];
  if (tenancies.length) {
    groups.push({
      type: 'tenancies',
      label: 'Tenancies',
      items: tenancies.map((t) => ({
        id: t.id,
        title: t.tenant,
        subtitle: `${t.property}${t.unit_no ? ' · ' + t.unit_no : ''} · ${t.landlord}`,
        status: t.status,
        href: '/',
      })),
    });
  }

  const documents = documentResult.status === 'fulfilled' ? (documentResult.value.data ?? []) : [];
  if (documents.length) {
    groups.push({
      type: 'documents',
      label: 'Documents',
      items: documents.map((d) => ({
        id: d.id,
        title: d.original_filename,
        subtitle: String(d.document_type ?? '').replaceAll('_', ' '),
        status: d.processing_status,
        href: '/documents',
      })),
    });
  }

  const leads = commercialResult.status === 'fulfilled' ? (commercialResult.value.data ?? []) : [];
  if (leads.length) {
    groups.push({
      type: 'leads',
      label: 'Commercial Leads',
      items: leads.map((l) => ({
        id: l.id,
        title: l.title,
        subtitle: String(l.requirement_type ?? '').replaceAll('_', ' '),
        status: l.status,
        href: `/commercial/requirements/${l.id}`,
      })),
    });
  }

  return NextResponse.json({ success: true, groups });
}
