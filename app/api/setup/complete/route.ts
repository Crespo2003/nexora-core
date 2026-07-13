import { NextResponse } from 'next/server';
import { getApiErrorMessage, getRouteSupabaseClient, requireTrustedOrigin } from '../../../../lib/supabase/server';

export async function POST(request: Request) {
  try {
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;

    const payload = await request.json() as { workspaceName: string; fullName: string; phone?: string; preferredLanguage?: 'en' | 'zh' };
    const supabase = getRouteSupabaseClient();
    const { data: userResult, error: userError } = await supabase.auth.getUser();

    if (userError || !userResult.user) {
      return NextResponse.json({ success: false, error: 'authentication-required' }, { status: 401 });
    }

    const setup = await supabase.rpc('bootstrap_first_workspace', {
      workspace_name: payload.workspaceName,
      profile_full_name: payload.fullName,
      profile_phone: payload.phone ?? '',
      profile_language: payload.preferredLanguage ?? 'en'
    });
    if (setup.error) {
      if (setup.error.message.includes('setup closed')) {
        return NextResponse.json({ success: false, error: 'setup-closed' }, { status: 403 });
      }
      throw setup.error;
    }

    const result = setup.data as { workspaceId: string; profileId: string; membershipId: string };

    return NextResponse.json({
      success: true,
      workspaceId: result.workspaceId,
      profileId: result.profileId,
      membershipId: result.membershipId
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: getApiErrorMessage(error) }, { status: 500 });
  }
}
