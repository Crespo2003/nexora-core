import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { previewCommercialCsv, sanitizeCsvText, toCsv, validateCommercialImportRow } from '../../../../lib/commercial/csv';
import { allowedCommercialChanges, commercialResource, commercialResources } from '../../../../lib/commercial/resources';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';

const templates = {
  companies: { required: ['legal_name'], identity: ['legal_name', 'registration_number'] },
  contacts: { required: ['company_id', 'full_name'], identity: ['company_id', 'email'] },
  requirements: { required: ['title', 'requirement_type', 'transaction_type'], identity: ['title', 'company_id'] },
  listings: { required: ['title', 'property_type', 'transaction_type'], identity: ['title', 'address'] }
} as const;
type ImportResource = keyof typeof templates;

export async function POST(request: Request) {
  try {
    const sizeError = rejectOversizedRequest(request, 2 * 1024 * 1024);
    if (sizeError) return sizeError;
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    const payload = await request.json() as { resource?: ImportResource; csv?: string; sourceName?: string; confirm?: boolean; previewHash?: string };
    const resource = payload.resource;
    const csv = typeof payload.csv === 'string' ? payload.csv : '';
    if (!resource || !templates[resource] || !csv) return fail(400, 'invalid-import-request');
    const template = templates[resource];
    const preview = previewCommercialCsv(csv, [...template.required], [...template.identity]);
    const previewHash = createHash('sha256').update(`${resource}\0${csv}`).digest('hex');
    const rowErrors = preview.rows.flatMap((row) => validateCommercialImportRow(resource, row).map((message) => ({ row: Number(row.__rowNumber), message })));
    const [databaseErrors, referenceErrors] = await Promise.all([findDatabaseDuplicates(auth.supabase, auth.workspaceId, resource, preview.rows, [...template.identity]), findInvalidReferences(auth.supabase, auth.workspaceId, resource, preview.rows)]);
    const errors = [...preview.errors, ...rowErrors, ...databaseErrors, ...referenceErrors];
    const duplicateRows = new Set([...preview.duplicates, ...databaseErrors.map((error) => error.row)]);
    const invalidRows = new Set(errors.map((error) => error.row));
    const validRows = preview.rows.filter((row) => !invalidRows.has(Number(row.__rowNumber)) && !duplicateRows.has(Number(row.__rowNumber)));
    const errorReportCsv = toCsv(errors.map((error) => ({ row: error.row, error: error.message })), ['row', 'error']);

    if (!payload.confirm) {
      return NextResponse.json({ success: true, preview: { ...preview, errors, duplicates: [...duplicateRows] }, previewHash, validRowCount: validRows.length, invalidRowCount: preview.rows.length - validRows.length, errorReportCsv, importCommitted: false, overwriteExisting: false });
    }
    if (payload.previewHash !== previewHash) return fail(409, 'preview-changed-reupload-required');
    if (!validRows.length) return fail(422, 'no-valid-rows', { errors, errorReportCsv });

    const job = await auth.supabase.from('commercial_import_jobs').insert({
      workspace_id: auth.workspaceId, resource_type: resource, request_hash: previewHash,
      source_name: safeSourceName(payload.sourceName), row_count: preview.rows.length, error_count: preview.rows.length - validRows.length,
      assigned_user_id: auth.user.id, created_by: auth.user.id, status: 'processing'
    }).select('id').single();
    if (job.error) {
      if (getApiErrorMessage(job.error) === 'duplicate-record') return fail(409, 'import-already-processed');
      throw job.error;
    }

    const records = validRows.map((row) => ({
      ...normalizeImportRecord(resource, row), workspace_id: auth.workspaceId, created_by: auth.user.id, assigned_user_id: auth.user.id,
      metadata: { importJobId: job.data.id, sourceRow: Number(row.__rowNumber) }
    }));
    const inserted = await auth.supabase.from(commercialResources[resource].table).insert(records).select('id');
    if (inserted.error) {
      await auth.supabase.from('commercial_import_jobs').update({ status: 'failed', result_json: { error: getApiErrorMessage(inserted.error) } }).eq('id', job.data.id).eq('workspace_id', auth.workspaceId);
      return fail(422, 'batch-import-failed', { errors, errorReportCsv, importJobId: job.data.id });
    }
    const completed = await auth.supabase.from('commercial_import_jobs').update({ status: 'completed', imported_count: inserted.data.length, result_json: { importedIds: inserted.data.map((row) => row.id), skippedRows: [...invalidRows] } }).eq('id', job.data.id).eq('workspace_id', auth.workspaceId);
    if (completed.error) throw completed.error;
    const activity = await auth.supabase.from('commercial_activities').insert({ workspace_id: auth.workspaceId, entity_type: resource, entity_id: job.data.id, activity_type: 'csv_import_completed', activity_json: { imported: inserted.data.length, skipped: preview.rows.length - inserted.data.length }, assigned_user_id: auth.user.id, created_by: auth.user.id });
    if (activity.error) throw activity.error;
    return NextResponse.json({ success: true, importCommitted: true, importJobId: job.data.id, importedCount: inserted.data.length, skippedCount: preview.rows.length - inserted.data.length, affectedRecordIds: inserted.data.map((row) => row.id), errors, errorReportCsv, overwriteExisting: false });
  } catch (error) {
    return fail(500, getApiErrorMessage(error));
  }
}

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent', 'finance'], request);
    if (auth instanceof Response) return auth;
    const resource = commercialResource(new URL(request.url).searchParams.get('resource') ?? '');
    if (!resource || !Object.prototype.hasOwnProperty.call(templates, resource)) return fail(400, 'unsupported-export');
    const query = await auth.supabase.from(commercialResources[resource].table).select('*').eq('workspace_id', auth.workspaceId).is('deleted_at', null);
    if (query.error) throw query.error;
    const hidden = new Set(['workspace_id','created_by','metadata','deleted_at','landlord_contact','address','document_paths','photo_paths']);
    const fields = commercialResources[resource].fields.filter((field) => !hidden.has(field) || ['owner','admin','manager'].includes(auth.role));
    const csv = toCsv((query.data ?? []) as Record<string, unknown>[], [...fields]);
    const activity = await auth.supabase.from('commercial_activities').insert({ workspace_id: auth.workspaceId, entity_type: resource, activity_type: 'export_performed', activity_json: { rowCount: query.data?.length ?? 0 }, assigned_user_id: auth.user.id, created_by: auth.user.id });
    if (activity.error) throw activity.error;
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="nexora-${resource}.csv"`, 'Cache-Control': 'private, no-store' } });
  } catch (error) { return fail(500, getApiErrorMessage(error)); }
}

async function findDatabaseDuplicates(supabase: any, workspaceId: string, resource: ImportResource, rows: Record<string, string>[], identity: string[]) {
  const existing = await supabase.from(commercialResources[resource].table).select(identity.join(',')).eq('workspace_id', workspaceId).is('deleted_at', null);
  if (existing.error) throw existing.error;
  const keys = new Set((existing.data ?? []).map((row: Record<string, unknown>) => identity.map((field) => String(row[field] ?? '').trim().toLowerCase()).join('|')));
  return rows.filter((row) => keys.has(identity.map((field) => row[field]?.toLowerCase() ?? '').join('|'))).map((row) => ({ row: Number(row.__rowNumber), message: 'duplicate-existing-record' }));
}

async function findInvalidReferences(supabase: any, workspaceId: string, resource: ImportResource, rows: Record<string,string>[]) {
  const fields = resource === 'contacts' ? [['company_id','commercial_companies'],['brand_id','commercial_brands']] : resource === 'requirements' ? [['company_id','commercial_companies'],['brand_id','commercial_brands'],['contact_id','commercial_contacts']] : [];
  const errors: Array<{row:number;message:string}> = [];
  for (const [field, table] of fields) {
    const ids = Array.from(new Set(rows.map((row)=>row[field]).filter((value)=>/^[0-9a-f-]{36}$/i.test(value))));
    if (!ids.length) continue;
    const result = await supabase.from(table).select('id').in('id',ids).eq('workspace_id',workspaceId).is('deleted_at',null);
    if (result.error) throw result.error;
    const valid = new Set((result.data??[]).map((row:Record<string,unknown>)=>String(row.id)));
    rows.filter((row)=>row[field]&&!valid.has(row[field])).forEach((row)=>errors.push({row:Number(row.__rowNumber),message:`invalid-reference:${field}`}));
  }
  return errors;
}

function normalizeImportRecord(resource: ImportResource, row: Record<string, string>) {
  const clean = allowedCommercialChanges(resource, Object.fromEntries(Object.entries(row).filter(([key, value]) => key !== '__rowNumber' && sanitizeCsvText(value) !== '').map(([key, value]) => [key, convertValue(key, sanitizeCsvText(value))])));
  return clean;
}

const numeric = new Set(['min_built_up','max_built_up','min_land_area','max_land_area','target_rental','max_rental','target_purchase_price','max_purchase_price','built_up','land_area','asking_rental','asking_sale_price','maintenance_fee','frontage','ceiling_height','parking']);
const booleans = new Set(['ground_floor_required','drive_through_required','loading_bay_required','three_phase_required','exhaust_required','grease_trap_required','gas_required','water_required','signage_required','outdoor_area_required','swimming_pool_required','commercial_zoning_required','negotiable','corner','ground_floor','loading_bay','three_phase_electricity','exhaust','grease_trap','gas','water','main_road_frontage','outdoor_area','swimming_pool','commercial_zoning']);
const arrays = new Set(['target_countries','target_cities','tags','preferred_locations','excluded_locations','allowed_businesses','prohibited_businesses','rejection_reasons']);
function convertValue(key: string, value: string) { if (numeric.has(key)) return Number(value); if (booleans.has(key)) return ['true','1','yes','y'].includes(value.toLowerCase()); if (arrays.has(key)) return value.split(/[;|]/).map((item) => sanitizeCsvText(item)).filter(Boolean); return value; }
function safeSourceName(value?: string) { return sanitizeCsvText(value || 'commercial-import.csv').replace(/[^a-zA-Z0-9._ -]/g, '').slice(0, 120) || 'commercial-import.csv'; }
function fail(status: number, error: string, extra: Record<string, unknown> = {}) { return NextResponse.json({ success: false, error, importCommitted: false, ...extra }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
