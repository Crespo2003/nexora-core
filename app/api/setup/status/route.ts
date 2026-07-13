import { NextResponse } from 'next/server';
import { getApiErrorMessage, getRouteSupabaseClient } from '../../../../lib/supabase/server';

export async function GET() {
  try {
    const supabase = getRouteSupabaseClient();
    const { data, error } = await supabase.rpc('workspace_setup_open');

    if (error) throw error;

    return NextResponse.json({
      success: true,
      setupOpen: Boolean(data)
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      setupOpen: false,
      error: getApiErrorMessage(error)
    }, { status: 500 });
  }
}
