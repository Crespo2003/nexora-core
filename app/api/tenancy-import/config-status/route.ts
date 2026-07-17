import { NextResponse } from 'next/server';
import { getOpenAiConfiguration } from '../../../../lib/ai/openAiConfig';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) {
      const payload: unknown = await auth.clone().json().catch(() => ({ success: false, error: 'authorization-failed' }));
      return NextResponse.json(payload, { status: auth.status, headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ success: true, ...getOpenAiConfiguration() }, {
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('[tenancy-extraction] config_status_failed', { error: error instanceof Error ? error.message.slice(0, 500) : 'unknown-error' });
    return NextResponse.json({ success: false, error: getApiErrorMessage(error) }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
