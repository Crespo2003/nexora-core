import { NextResponse } from 'next/server';
import { ACTIVE_WORKSPACE_COOKIE, getApiErrorMessage, getRouteSupabaseClient, requireTrustedOrigin } from '../../../../lib/supabase/server';

type ProvisionPayload = {
  workspaceName?: string; businessType?: string; country?: string; timezone?: string;
  preferredCurrency?: string; preferredLanguage?: string; companyRegistrationNumber?: string;
  contactNumber?: string; idempotencyKey?: string;
};

export async function POST(request: Request) {
  try {
    const originError = requireTrustedOrigin(request);
    if (originError) return originError;
    const payload = await request.json() as ProvisionPayload;
    if (!payload.workspaceName?.trim() || !payload.businessType?.trim() || !payload.country?.trim() ||
        !payload.timezone?.trim() || !/^[A-Z]{3}$/.test(payload.preferredCurrency ?? '') ||
        !['en', 'zh', 'ms'].includes(payload.preferredLanguage ?? '') ||
        !payload.idempotencyKey || !/^[0-9a-f-]{36}$/i.test(payload.idempotencyKey)) {
      return NextResponse.json({ success: false, error: 'invalid-workspace-details' }, { status: 400 });
    }

    const supabase = getRouteSupabaseClient();
    const userResult = await supabase.auth.getUser();
    if (userResult.error || !userResult.data.user) return NextResponse.json({ success: false, error: 'authentication-required' }, { status: 401 });
    if (!userResult.data.user.email_confirmed_at) return NextResponse.json({ success: false, error: 'email-verification-required' }, { status: 403 });

    const provision = await supabase.rpc('provision_workspace', {
      workspace_name: payload.workspaceName.trim(), business_type: payload.businessType.trim(),
      country: payload.country.trim(), timezone: payload.timezone.trim(),
      preferred_currency: payload.preferredCurrency, preferred_language: payload.preferredLanguage,
      company_registration_number: payload.companyRegistrationNumber?.trim() ?? '',
      contact_number: payload.contactNumber?.trim() ?? '', idempotency_key: payload.idempotencyKey
    });
    if (provision.error) throw provision.error;
    const result = provision.data as { workspaceId: string; name: string; role: 'owner'; idempotentReplay: boolean };
    const response = NextResponse.json({ success: true, workspace: result });
    response.cookies.set(ACTIVE_WORKSPACE_COOKIE, result.workspaceId, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 30
    });
    return response;
  } catch (error) {
    const code = getApiErrorMessage(error);
    return NextResponse.json({ success: false, error: code }, { status: code === 'permission-denied' ? 403 : 500 });
  }
}
