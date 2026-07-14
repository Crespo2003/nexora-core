import { NextResponse } from 'next/server';
import { maskContact } from '../../../../lib/commercial/confidentiality';
import { validateDealStageTransition } from '../../../../lib/commercial/deals';
import { allowedCommercialChanges, commercialResource, commercialResources } from '../../../../lib/commercial/resources';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export async function GET(request: Request, { params }: { params: { resource: string } }) {
  try {
    const resource = commercialResource(params.resource);
    if (!resource) return responseError(404, 'resource', 'unknown-commercial-resource');
    const auth = await requireWorkspaceAccess(undefined, request);
    if (auth instanceof Response) return auth;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const search = searchParams.get('search')?.trim();
    const config = commercialResources[resource];
    let query = auth.supabase.from(config.table).select('*').eq('workspace_id', auth.workspaceId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(Math.min(Number(searchParams.get('limit') ?? 200), 500));
    if (id) query = query.eq('id', id);
    if (search && config.search.length) query = query.or(config.search.map((field) => `${field}.ilike.%${escapeSearch(search)}%`).join(','));
    const result = await query;
    if (result.error) throw result.error;
    let rows = (result.data ?? []).map((row) => protectRow(resource, row as Record<string, unknown>, auth.role, auth.user.id));
    if (resource === 'listings') {
      const summaries = await auth.supabase.rpc('commercial_confidential_listing_summaries', { p_workspace_id: auth.workspaceId, p_listing_id: id || null });
      if (summaries.error) throw summaries.error;
      const safeSummaries = ((summaries.data ?? []) as Record<string, unknown>[]).filter((row) => !search || summaryMatches(row, search));
      const visibleIds = new Set(rows.map((row) => String(row.id)));
      rows = [...rows, ...safeSummaries.filter((row) => !visibleIds.has(String(row.id)))];
    }
    if (id && rows[0] && resource === 'listings' && ['restricted', 'highly_confidential'].includes(String(rows[0].confidentiality_level))) {
      const access = await auth.supabase.from('commercial_activities').insert({ workspace_id: auth.workspaceId, entity_type: 'listings', entity_id: id, activity_type: 'confidential_record_accessed', activity_json: { role: auth.role }, sensitive_access: true, assigned_user_id: auth.user.id });
      if (access.error) throw access.error;
    }
    return NextResponse.json({ success: true, resource, rows, role: auth.role, userId: auth.user.id });
  } catch (error) {
    return responseError(500, 'database', getApiErrorMessage(error));
  }
}

export async function POST(request: Request, context: { params: { resource: string } }) {
  return mutate(request, context, 'create');
}

export async function PATCH(request: Request, context: { params: { resource: string } }) {
  return mutate(request, context, 'update');
}

export async function DELETE(request: Request, context: { params: { resource: string } }) {
  return mutate(request, context, 'delete');
}

async function mutate(request: Request, { params }: { params: { resource: string } }, operation: 'create' | 'update' | 'delete') {
  try {
    const resource = commercialResource(params.resource);
    if (!resource) return responseError(404, 'resource', 'unknown-commercial-resource');
    const roles = resource === 'deals' ? ['owner', 'admin', 'manager', 'agent', 'finance'] as const : ['owner', 'admin', 'manager', 'agent'] as const;
    const auth = await requireWorkspaceAccess([...roles], request);
    if (auth instanceof Response) return auth;
    const payload = await request.json() as Record<string, unknown>;
    const id = String(payload.id ?? '');
    if (operation !== 'create' && !id) return responseError(400, 'validation', 'record-id-required');
    if (operation === 'delete') {
      const deleted = await auth.supabase.from(commercialResources[resource].table).update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('workspace_id', auth.workspaceId).select('id').maybeSingle();
      if (deleted.error) throw deleted.error;
      if (!deleted.data) return responseError(404, 'record', 'record-not-found');
      return NextResponse.json({ success: true, affectedRecordIds: [id], rollbackStatus: 'not-required' });
    }
    let changes = allowedCommercialChanges(resource, payload);
    if (auth.role === 'finance' && resource === 'deals') {
      const financeFields = new Set(['deal_value', 'expected_commission', 'commission_share', 'probability', 'notes']);
      changes = Object.fromEntries(Object.entries(changes).filter(([key]) => financeFields.has(key)));
    }
    if (!Object.keys(changes).length) return responseError(400, 'validation', 'no-valid-fields');
    if (operation === 'update' && resource === 'deals' && typeof changes.stage === 'string') {
      const current = await auth.supabase.from('commercial_deals').select('stage').eq('id', id).eq('workspace_id', auth.workspaceId).maybeSingle();
      if (current.error) throw current.error;
      if (!current.data) return responseError(404, 'record', 'record-not-found');
      if (!validateDealStageTransition(current.data.stage, changes.stage)) return responseError(409, 'validation', 'invalid-deal-stage-transition');
    }
    const result = operation === 'create'
      ? await auth.supabase.from(commercialResources[resource].table).insert({ ...changes, workspace_id: auth.workspaceId, created_by: auth.user.id, assigned_user_id: changes.assigned_user_id ?? auth.user.id }).select('*').single()
      : await auth.supabase.from(commercialResources[resource].table).update(changes).eq('id', id).eq('workspace_id', auth.workspaceId).select('*').maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return responseError(404, 'record', 'record-not-found');
    return NextResponse.json({ success: true, record: protectRow(resource, result.data as Record<string, unknown>, auth.role, auth.user.id), affectedRecordIds: [String(result.data.id)], rollbackStatus: 'database-trigger-atomic' });
  } catch (error) {
    return responseError(500, 'database', getApiErrorMessage(error));
  }
}

function protectRow(resource: string, row: Record<string, unknown>, role: string, userId: string) {
  const privileged = ['owner', 'admin', 'manager'].includes(role) || (role === 'agent' && row.assigned_user_id === userId);
  if (resource === 'contacts' && !privileged) return { ...row, phone: maskContact(String(row.phone ?? '')), whatsapp_number: maskContact(String(row.whatsapp_number ?? '')), email: maskContact(String(row.email ?? '')), notes: '' };
  if (resource !== 'listings' || privileged || row.confidentiality_level === 'normal') return row;
  const highly = row.confidentiality_level === 'highly_confidential';
  return { ...row, property_name: highly ? '' : row.property_name, address: row.concealed_address || row.area || row.city || '', landlord_name: '', landlord_contact: '', photo_paths: [], document_paths: [], notes: '', latitude: null, longitude: null };
}

function escapeSearch(value: string) { return value.replace(/[,%()]/g, ' '); }
function summaryMatches(row: Record<string, unknown>, search: string) { const value = search.toLowerCase(); return ['area','property_type','transaction_type','availability_status'].some((key) => String(row[key] ?? '').toLowerCase().includes(value)); }
function responseError(status: number, failedStage: string, technicalReference: string) {
  return NextResponse.json({ success: false, failedStage, affectedRecordIds: [], rollbackStatus: 'not-required', message: { en: 'The commercial CRM request could not be completed.', zh: '无法完成商业 CRM 请求。' }, technicalReference }, { status });
}
