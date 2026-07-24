import { NextResponse } from 'next/server';
import { requireWorkspaceAccess } from '../../../lib/supabase/server';
import { maskCrmContact } from '../../../lib/crm/permissions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireWorkspaceAccess();
  if (auth instanceof Response) return auth;
  const { supabase, workspaceId, role } = auth;

  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';

  if (q.length < 2) {
    return NextResponse.json({ success: true, groups: [] });
  }

  const pattern = `%${q}%`;

  const [tenantsResult, landlordsResult, propertiesResult, documentResult, commercialResult, contactsResult, enquiriesResult, appointmentsResult, followUpsResult, dealsResult] = await Promise.allSettled([
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
    supabase
      .from('contacts')
      .select('id, full_name, company_name, phone_original, email, client_type')
      .eq('workspace_id', workspaceId)
      .is('archived_at', null)
      .or(`full_name.ilike.${pattern},company_name.ilike.${pattern},phone_original.ilike.${pattern},email.ilike.${pattern}`)
      .limit(6),
    supabase
      .from('crm_enquiries')
      .select('id, enquiry_number, transaction_type, property_type, stage')
      .eq('workspace_id', workspaceId)
      .is('archived_at', null)
      .or(`enquiry_number.ilike.${pattern},property_type.ilike.${pattern},notes.ilike.${pattern}`)
      .limit(6),
    supabase
      .from('crm_appointments')
      .select('id, title, appointment_type, start_at, status, location')
      .eq('workspace_id', workspaceId)
      .or(`title.ilike.${pattern},location.ilike.${pattern},notes.ilike.${pattern}`)
      .limit(6),
    supabase
      .from('crm_follow_ups')
      .select('id, title, method, due_at, status, priority, enquiry_id')
      .eq('workspace_id', workspaceId)
      .or(`title.ilike.${pattern},notes.ilike.${pattern}`)
      .limit(6),
    supabase
      .from('crm_deals')
      .select('id, deal_number, title, transaction_type, stage')
      .eq('workspace_id', workspaceId)
      .is('archived_at', null)
      .or(`deal_number.ilike.${pattern},title.ilike.${pattern},listing_reference.ilike.${pattern}`)
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

  const contacts = contactsResult.status === 'fulfilled' ? (contactsResult.value.data ?? []) : [];
  if (contacts.length) {
    groups.push({
      type: 'clients',
      label: 'Clients',
      label_zh: '客户',
      items: contacts.map((contact) => ({
        id: contact.id,
        title: contact.full_name || contact.company_name || 'Client',
        subtitle: ['finance','viewer'].includes(role) ? maskCrmContact(contact.phone_original || contact.email || '') : contact.phone_original || contact.email || '',
        status: contact.client_type,
        href: `/crm?client=${contact.id}`,
      })),
    });
  }

  const enquiries = enquiriesResult.status === 'fulfilled' ? (enquiriesResult.value.data ?? []) : [];
  if (enquiries.length) {
    groups.push({
      type: 'enquiries',
      label: 'Enquiries',
      label_zh: '询盘',
      items: enquiries.map((enquiry) => ({
        id: enquiry.id,
        title: enquiry.enquiry_number,
        subtitle: [enquiry.transaction_type, enquiry.property_type].filter(Boolean).join(' · '),
        status: enquiry.stage,
        href: `/crm?enquiry=${enquiry.id}`,
      })),
    });
  }

  const appointments = appointmentsResult.status === 'fulfilled' ? (appointmentsResult.value.data ?? []) : [];
  if (appointments.length) {
    groups.push({
      type: 'appointments',
      label: 'Appointments',
      label_zh: '预约',
      items: appointments.map((appointment) => ({
        id: appointment.id,
        title: appointment.title,
        subtitle: [appointment.appointment_type, appointment.location].filter(Boolean).join(' · '),
        status: appointment.status,
        href: '/appointments',
      })),
    });
  }

  const followUps = followUpsResult.status === 'fulfilled' ? (followUpsResult.value.data ?? []) : [];
  if (followUps.length) {
    groups.push({
      type: 'follow-ups',
      label: 'Follow-ups',
      label_zh: '跟进',
      items: followUps.map((followUp) => ({
        id: followUp.id,
        title: followUp.title,
        subtitle: [followUp.method, followUp.due_at].filter(Boolean).join(' · '),
        status: followUp.status,
        href: followUp.enquiry_id ? `/crm?enquiry=${followUp.enquiry_id}` : '/crm',
      })),
    });
  }

  const deals = dealsResult.status === 'fulfilled' ? (dealsResult.value.data ?? []) : [];
  if (deals.length) {
    groups.push({
      type: 'deals',
      label: 'Deals',
      label_zh: '交易',
      items: deals.map((deal) => ({
        id: deal.id,
        title: deal.title,
        subtitle: [deal.deal_number, deal.transaction_type].filter(Boolean).join(' · '),
        status: deal.stage,
        href: '/deals',
      })),
    });
  }

  return NextResponse.json({ success: true, groups });
}
