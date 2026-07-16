import { NextResponse } from 'next/server';
import { requireTrustedOrigin } from '../../../../lib/supabase/server';

export async function POST(request: Request) {
  const originError = requireTrustedOrigin(request);
  if (originError) return originError;
  return NextResponse.json(
    { success: false, error: 'legacy-setup-retired', next: '/onboarding/workspace' },
    { status: 410 }
  );
}
