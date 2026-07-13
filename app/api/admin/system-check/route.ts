import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export async function GET() {
  try {
    const auth = await requireWorkspaceAccess(['owner', 'admin']);
    if (auth instanceof Response) return auth;

    const { supabase, workspaceId } = auth;
    const check = await supabase.rpc('sprint_004_system_check', { target_workspace_id: workspaceId });
    if (check.error) throw check.error;

    return NextResponse.json({
      success: true,
      auth: 'Passed',
      workspace: 'Passed',
      environment: {
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Passed' : 'Not configured',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'Passed' : 'Not configured'
      },
      check: check.data
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      auth: 'Failed',
      workspace: 'Failed',
      error: getApiErrorMessage(error)
    }, { status: 500 });
  }
}
