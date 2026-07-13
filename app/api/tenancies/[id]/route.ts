import { NextResponse } from 'next/server';
import { getApiErrorMessage, getServerSupabaseClient } from '../../../../lib/supabase/server';

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = getServerSupabaseClient();
    const { error } = await supabase.from('tenancies').delete().eq('id', params.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Delete tenancy failed', error);
    return NextResponse.json({ error: getApiErrorMessage(error), stage: 'delete-tenancy' }, { status: 500 });
  }
}
