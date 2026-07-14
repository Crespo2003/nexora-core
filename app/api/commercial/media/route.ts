import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { commercialMediaBucket, commercialMediaExtension, maxCommercialMediaBytes, validateCommercialMedia } from '../../../../lib/commercial/media';
import { inferMimeTypeFromName } from '../../../../lib/documents/upload';
import { checkUploadRateLimit } from '../../../../lib/security/uploadRateLimit';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(undefined, request);
    if (auth instanceof Response) return auth;
    const listingId = new URL(request.url).searchParams.get('listingId');
    if (!listingId) return fail(400, 'listing-required');
    const listing = await auth.supabase.from('commercial_listings').select('id, confidentiality_level, assigned_user_id').eq('id', listingId).eq('workspace_id', auth.workspaceId).maybeSingle();
    if (listing.error) throw listing.error;
    if (!listing.data) return fail(404, 'listing-unavailable');
    const media = await auth.supabase.from('commercial_listing_media').select('id, listing_id, media_type, display_name, mime_type, file_size, sort_order, created_at').eq('listing_id', listingId).eq('workspace_id', auth.workspaceId).is('deleted_at', null).order('sort_order').order('created_at');
    if (media.error) throw media.error;
    return NextResponse.json({ success: true, rows: media.data, canManage: ['owner','admin','manager'].includes(auth.role) || (auth.role === 'agent' && listing.data.assigned_user_id === auth.user.id) });
  } catch (error) { return fail(500, getApiErrorMessage(error)); }
}

export async function POST(request: Request) {
  let storagePath = '';
  let supabase: any;
  try {
    const sizeError = rejectOversizedRequest(request, maxCommercialMediaBytes + 1024 * 1024);
    if (sizeError) return sizeError;
    const auth = await requireWorkspaceAccess(['owner','admin','manager','agent'], request);
    if (auth instanceof Response) return auth;
    ({ supabase } = auth);
    const limit = checkUploadRateLimit(`commercial-media:${auth.workspaceId}:${auth.user.id}`);
    if (!limit.allowed) return fail(429, 'upload-rate-limit', { retryAfterSeconds: limit.retryAfterSeconds });
    const form = await request.formData();
    const file = form.get('file');
    const listingId = String(form.get('listingId') ?? '');
    const mediaType = String(form.get('mediaType') ?? '');
    if (!(file instanceof File) || !listingId) return fail(400, 'file-and-listing-required');
    const listing = await supabase.from('commercial_listings').select('id, assigned_user_id').eq('id', listingId).eq('workspace_id', auth.workspaceId).maybeSingle();
    if (listing.error) throw listing.error;
    if (!listing.data) return fail(404, 'listing-unavailable');
    if (auth.role === 'agent' && listing.data.assigned_user_id !== auth.user.id) return fail(403, 'permission-denied');
    const mimeType = file.type || inferMimeTypeFromName(file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    const validation = validateCommercialMedia({ buffer, filename: file.name, mimeType, size: file.size, mediaType });
    if (validation) return fail(400, validation);
    storagePath = `${auth.workspaceId}/commercial/${listingId}/${randomUUID()}.${commercialMediaExtension(mimeType)}`;
    const upload = await supabase.storage.from(commercialMediaBucket).upload(storagePath, buffer, { contentType: mimeType, upsert: false });
    if (upload.error) throw upload.error;
    const count = await supabase.from('commercial_listing_media').select('id', { count: 'exact', head: true }).eq('listing_id', listingId).eq('workspace_id', auth.workspaceId).is('deleted_at', null);
    if (count.error) throw count.error;
    const displayName = `${mediaType.replaceAll('_', ' ')} ${(count.count ?? 0) + 1}`;
    const record = await supabase.from('commercial_listing_media').insert({ workspace_id: auth.workspaceId, listing_id: listingId, media_type: mediaType, display_name: displayName, storage_bucket: commercialMediaBucket, storage_path: storagePath, mime_type: mimeType, file_size: file.size, sort_order: count.count ?? 0, assigned_user_id: listing.data.assigned_user_id ?? auth.user.id, created_by: auth.user.id }).select('id, listing_id, media_type, display_name, mime_type, file_size, sort_order, created_at').single();
    if (record.error) throw record.error;
    storagePath = '';
    await supabase.from('commercial_activities').insert({ workspace_id: auth.workspaceId, entity_type: 'listings', entity_id: listingId, activity_type: 'commercial_media_uploaded', activity_json: { mediaId: record.data.id, mediaType, mimeType, fileSize: file.size }, assigned_user_id: auth.user.id, created_by: auth.user.id });
    return NextResponse.json({ success: true, record: record.data });
  } catch (error) {
    if (storagePath) await supabase?.storage.from(commercialMediaBucket).remove([storagePath]);
    return fail(500, getApiErrorMessage(error));
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(['owner','admin','manager','agent'], request);
    if (auth instanceof Response) return auth;
    const { mediaId } = await request.json() as { mediaId?: string };
    if (!mediaId) return fail(400, 'media-required');
    const media = await auth.supabase.from('commercial_listing_media').select('id, listing_id, storage_bucket, storage_path, assigned_user_id').eq('id', mediaId).eq('workspace_id', auth.workspaceId).maybeSingle();
    if (media.error) throw media.error;
    if (!media.data) return fail(404, 'media-unavailable');
    if (auth.role === 'agent' && media.data.assigned_user_id !== auth.user.id) return fail(403, 'permission-denied');
    const removed = await auth.supabase.storage.from(media.data.storage_bucket).remove([media.data.storage_path]);
    if (removed.error) throw removed.error;
    const deleted = await auth.supabase.from('commercial_listing_media').delete().eq('id', mediaId).eq('workspace_id', auth.workspaceId);
    if (deleted.error) throw deleted.error;
    await auth.supabase.from('commercial_activities').insert({ workspace_id: auth.workspaceId, entity_type: 'listings', entity_id: media.data.listing_id, activity_type: 'commercial_media_deleted', activity_json: { mediaId }, assigned_user_id: auth.user.id, created_by: auth.user.id });
    return NextResponse.json({ success: true, affectedRecordIds: [mediaId] });
  } catch (error) { return fail(500, getApiErrorMessage(error)); }
}

function fail(status: number, error: string, extra: Record<string, unknown> = {}) { return NextResponse.json({ success: false, error, ...extra }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
