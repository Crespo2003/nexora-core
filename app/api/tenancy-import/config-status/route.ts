import { NextResponse } from 'next/server';
import { getOpenAiConfiguration } from '../../../../lib/ai/openAiConfig';
import { requireWorkspaceAccess } from '../../../../lib/supabase/server';

export async function GET(request: Request) {
  const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
  if (auth instanceof Response) return auth;
  return NextResponse.json(getOpenAiConfiguration(), {
    headers: { 'Cache-Control': 'no-store' }
  });
}
