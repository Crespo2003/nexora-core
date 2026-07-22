import { NextResponse } from 'next/server';
import { requireWorkspaceAccess } from '../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

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

  const [tenantsResult, landlordsResult, propertiesResult, documentResult, commercialResult] = await Promise.allSettled([
    supabase
      .from('tenancies')
      .select('id, tenant, landlord, property, unit_no, status')
      .eq('workspace_id', workspaceId)
      .ilike('tenant', pattern)
      .limit(6),
    supabase
      .from('tenancies')
      .select('id, tenant, landlord, property, unit_no, status')
      .eq('workspace_id', workspaceId)
      .ilike('landlord', pattern)
      .limit(6),
    supabase
      .from('tenancies')
      .select('id, tenant, landlord, property, unit_no, status')
      .eq('workspace_id', workspaceId)
      .or(`property.ilike.${pattern},unit_no.ilike.${pattern}`)
      .limit(6),
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

  const tenants = tenantsResult.status === 'fulfilled' ? (tenantsResult.value.data ?? []) : [];
  if (tenants.length) {
    groups.push({
      type: 'tenants',
      label: 'Tenants',
      items: tenants.map((t) => ({
        id: t.id,
        title: t.tenant,
        subtitle: `${t.property}${t.unit_no ? ' · ' + t.unit_no : ''}`,
        status: t.status,
        href: '/',
      })),
    });
  }

  const landlords = landlordsResult.status === 'fulfilled' ? (landlordsResult.value.data ?? []) : [];
  if (landlords.length) {
    groups.push({
      type: 'landlords',
      label: 'Landlords',
      items: landlords.map((t) => ({
        id: `landlord-${t.id}`,
        title: t.landlord,
        subtitle: `${t.property}${t.unit_no ? ' · ' + t.unit_no : ''} · ${t.tenant}`,
        status: t.status,
        href: '/',
      })),
    });
  }

  const properties = propertiesResult.status === 'fulfilled' ? (propertiesResult.value.data ?? []) : [];
  if (properties.length) {
    groups.push({
      type: 'properties',
      label: 'Properties',
      items: properties.map((t) => ({
        id: `property-${t.id}`,
        title: t.property,
        subtitle: `${t.unit_no ? t.unit_no + ' · ' : ''}${t.tenant}`,
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
