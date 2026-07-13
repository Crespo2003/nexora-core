import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireWorkspaceAccess(['owner', 'admin'], request);
    if (auth instanceof Response) return auth;
    const { supabase } = auth;
    const { error } = await supabase.from('tenancies').delete().eq('id', params.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Delete tenancy failed');
    return NextResponse.json({ error: getApiErrorMessage(error), stage: 'delete-tenancy' }, { status: 500 });
  }
}
