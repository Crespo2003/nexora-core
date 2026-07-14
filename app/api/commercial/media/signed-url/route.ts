import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../../lib/supabase/server';

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(undefined, request);
    if (auth instanceof Response) return auth;
    const { mediaId, disposition = 'inline' } = await request.json() as { mediaId?: string; disposition?: 'inline' | 'attachment' };
    if (!mediaId) return fail(400, 'media-required');
    const media = await auth.supabase.from('commercial_listing_media').select('id, listing_id, storage_bucket, storage_path, display_name, mime_type').eq('id', mediaId).eq('workspace_id', auth.workspaceId).maybeSingle();
    if (media.error) throw media.error;
    if (!media.data) return fail(404, 'media-unavailable');
    const signed = await auth.supabase.storage.from(media.data.storage_bucket).createSignedUrl(media.data.storage_path, 300, { download: disposition === 'attachment' ? media.data.display_name : false });
    if (signed.error) throw signed.error;
    const activity = await auth.supabase.from('commercial_activities').insert({ workspace_id: auth.workspaceId, entity_type: 'listings', entity_id: media.data.listing_id, activity_type: disposition === 'attachment' ? 'commercial_media_downloaded' : 'commercial_media_viewed', activity_json: { mediaId }, sensitive_access: true, assigned_user_id: auth.user.id, created_by: auth.user.id });
    if (activity.error) throw activity.error;
    return NextResponse.json({ success: true, signedUrl: signed.data.signedUrl, expiresIn: 300, mimeType: media.data.mime_type });
  } catch (error) { return fail(500, getApiErrorMessage(error)); }
}

function fail(status: number, error: string) { return NextResponse.json({ success: false, error }, { status, headers: { 'Cache-Control': 'private, no-store' } }); }
