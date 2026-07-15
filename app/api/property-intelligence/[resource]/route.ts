import { NextResponse } from 'next/server';
import { haversineDistanceKm, estimateTravelMinutes } from '../../../../lib/property-intelligence/calculations';
import { allowedPropertyChanges, propertyResource, propertyResources } from '../../../../lib/property-intelligence/resources';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const writeRoles = ['owner', 'admin', 'manager', 'agent'] as const;

export async function GET(request: Request, { params }: { params: { resource: string } }) {
  try {
    const resource = propertyResource(params.resource);
    if (!resource) return errorResponse(404, 'unknown-property-resource');
    const auth = await requireWorkspaceAccess(undefined, request);
    if (auth instanceof Response) return auth;
    const search = new URL(request.url).searchParams;
    let query = auth.supabase.from(propertyResources[resource].table).select('*').eq('workspace_id', auth.workspaceId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(500);
    if (search.get('id')) query = query.eq('id', search.get('id'));
    if (search.get('analysis_id') && resource !== 'analyses') query = query.eq('analysis_id', search.get('analysis_id'));
    const result = await query;
    if (result.error) throw result.error;
    return NextResponse.json({ success: true, rows: result.data ?? [], role: auth.role, userId: auth.user.id });
  } catch (error) {
    return errorResponse(500, getApiErrorMessage(error));
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
    const oversized = rejectOversizedRequest(request, 64 * 1024);
    if (oversized) return oversized;
    const resource = propertyResource(params.resource);
    if (!resource || resource === 'scores') return errorResponse(404, 'unknown-or-read-only-resource');
    const auth = await requireWorkspaceAccess([...writeRoles], request);
    if (auth instanceof Response) return auth;
    const payload = await request.json() as Record<string, unknown>;
    const id = String(payload.id ?? '');
    if (operation !== 'create' && !id) return errorResponse(400, 'record-id-required');
    if (operation === 'delete') {
      const deleted = await auth.supabase.from(propertyResources[resource].table).delete().eq('id', id).eq('workspace_id', auth.workspaceId).select('id').maybeSingle();
      if (deleted.error) throw deleted.error;
      if (!deleted.data) return errorResponse(404, 'record-not-found');
      return NextResponse.json({ success: true, id });
    }

    let changes = allowedPropertyChanges(resource, payload);
    if (operation === 'create' && resource === 'analyses') changes = await sourceAnalysis(auth, payload);
    if (operation === 'create' && resource !== 'analyses') changes = await enrichChild(auth, resource, changes);
    const validation = validate(resource, changes, operation);
    if (validation) return errorResponse(400, validation);

    const result = operation === 'create'
      ? await auth.supabase.from(propertyResources[resource].table).insert({ ...changes, workspace_id: auth.workspaceId, created_by: auth.user.id, assigned_user_id: changes.assigned_user_id ?? auth.user.id }).select('*').single()
      : await auth.supabase.from(propertyResources[resource].table).update(changes).eq('id', id).eq('workspace_id', auth.workspaceId).select('*').maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return errorResponse(404, 'record-not-found');
    return NextResponse.json({ success: true, record: result.data });
  } catch (error) {
    return errorResponse(500, getApiErrorMessage(error));
  }
}

async function sourceAnalysis(auth: Exclude<Awaited<ReturnType<typeof requireWorkspaceAccess>>, Response>, payload: Record<string, unknown>) {
  const tenancyId = typeof payload.tenancy_id === 'string' ? payload.tenancy_id : '';
  const listingId = typeof payload.commercial_listing_id === 'string' ? payload.commercial_listing_id : '';
  if (Boolean(tenancyId) === Boolean(listingId)) throw new Error('exactly-one-property-source-required');
  if (tenancyId) {
    const source = await auth.supabase.from('tenancies').select('id,property,unit_no,property_address,property_type,monthly_rental').eq('id', tenancyId).eq('workspace_id', auth.workspaceId).maybeSingle();
    if (source.error) throw source.error;
    if (!source.data) throw new Error('property-source-not-found');
    return { tenancy_id: tenancyId, commercial_listing_id: null, property_source: 'residential_tenancy', property_name: [source.data.property, source.data.unit_no].filter(Boolean).join(' - '), property_address: source.data.property_address, property_type: source.data.property_type, estimated_monthly_rental: source.data.monthly_rental, assigned_user_id: payload.assigned_user_id ?? auth.user.id };
  }
  const source = await auth.supabase.from('commercial_listings').select('id,title,property_name,address,concealed_address,property_type,built_up,asking_rental,asking_sale_price,latitude,longitude').eq('id', listingId).eq('workspace_id', auth.workspaceId).is('deleted_at', null).maybeSingle();
  if (source.error) throw source.error;
  if (!source.data) throw new Error('property-source-not-found');
  return { tenancy_id: null, commercial_listing_id: listingId, property_source: 'commercial_listing', property_name: source.data.property_name || source.data.title, property_address: source.data.address || source.data.concealed_address, property_type: source.data.property_type, built_up_sqft: source.data.built_up, estimated_monthly_rental: source.data.asking_rental, purchase_price: source.data.asking_sale_price, latitude: source.data.latitude, longitude: source.data.longitude, assigned_user_id: payload.assigned_user_id ?? auth.user.id };
}

async function enrichChild(auth: Exclude<Awaited<ReturnType<typeof requireWorkspaceAccess>>, Response>, resource: 'comparables' | 'nearby', changes: Record<string, unknown>) {
  const analysisId = String(changes.analysis_id ?? '');
  const analysis = await auth.supabase.from('property_analyses').select('id,latitude,longitude').eq('id', analysisId).eq('workspace_id', auth.workspaceId).is('deleted_at', null).maybeSingle();
  if (analysis.error) throw analysis.error;
  if (!analysis.data) throw new Error('analysis-not-found');
  if (resource === 'comparables') {
    const amount = changes.comparable_type === 'sale' ? number(changes.price) : number(changes.rental);
    const builtUp = number(changes.built_up_sqft);
    if (!number(changes.psf) && amount && builtUp) changes.psf = Math.round(amount / builtUp * 10000) / 10000;
  }
  const latitude = finiteNumber(changes.latitude);
  const longitude = finiteNumber(changes.longitude);
  if (latitude !== null && longitude !== null && analysis.data.latitude !== null && analysis.data.longitude !== null) {
    changes.distance_km = haversineDistanceKm(Number(analysis.data.latitude), Number(analysis.data.longitude), latitude, longitude);
    if (resource === 'nearby' && !number(changes.travel_time_minutes)) changes.travel_time_minutes = estimateTravelMinutes(Number(changes.distance_km), changes.travel_mode as 'driving');
  }
  return changes;
}

function validate(resource: 'analyses' | 'comparables' | 'nearby', changes: Record<string, unknown>, operation: string) {
  for (const field of ['built_up_sqft','purchase_price','down_payment','estimated_market_value','estimated_monthly_rental','monthly_operating_cost','monthly_financing_cost','price','rental','psf','distance_km','travel_time_minutes']) {
    if (changes[field] !== undefined && changes[field] !== null && (!Number.isFinite(Number(changes[field])) || Number(changes[field]) < 0)) return `${field}-must-be-non-negative`;
  }
  if (resource === 'comparables' && operation === 'create' && (!String(changes.property_name ?? '').trim() || !String(changes.source_name ?? '').trim())) return 'comparable-name-and-source-required';
  if (resource === 'nearby' && operation === 'create' && (!String(changes.name ?? '').trim() || !String(changes.source_name ?? '').trim())) return 'nearby-name-and-source-required';
  return null;
}
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; }
function finiteNumber(value: unknown) { if (value === '' || value === null || value === undefined) return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function errorResponse(status: number, error: string) { return NextResponse.json({ success: false, error }, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } }); }
