import { NextResponse } from 'next/server';
import { getApiErrorMessage, getServerSupabaseClient } from '../../../../lib/supabase/server';
import type { CollectionPayload, TenancyPayload } from '../../../../lib/rental/payloads';

export async function POST(request: Request) {
  let createdTenancyId: string | null = null;

  try {
    const { tenancy, collection } = (await request.json()) as {
      tenancy: TenancyPayload;
      collection: Omit<CollectionPayload, 'tenancy_id'>;
    };

    const supabase = getServerSupabaseClient();

    const duplicate = await supabase
      .from('tenancies')
      .select('id')
      .eq('tenant', tenancy.tenant)
      .eq('property', tenancy.property)
      .eq('unit_no', tenancy.unit_no ?? '')
      .maybeSingle();

    if (duplicate.error) throw duplicate.error;
    if (duplicate.data) {
      return NextResponse.json({ error: 'duplicate-tenancy', stage: 'duplicate-check' }, { status: 409 });
    }

    const tenancyInsert = await supabase.from('tenancies').insert(tenancy).select('*').single();
    if (tenancyInsert.error) throw tenancyInsert.error;
    createdTenancyId = tenancyInsert.data.id;

    const collectionInsert = await supabase
      .from('rental_collections')
      .insert({ ...collection, tenancy_id: createdTenancyId })
      .select('*')
      .single();

    if (collectionInsert.error) throw collectionInsert.error;

    return NextResponse.json({
      tenancy: tenancyInsert.data,
      collection: collectionInsert.data
    });
  } catch (error) {
    console.error('Create tenancy with collection failed', error);

    if (createdTenancyId) {
      try {
        const supabase = getServerSupabaseClient();
        await supabase.from('tenancies').delete().eq('id', createdTenancyId);
      } catch (cleanupError) {
        console.error('Create tenancy cleanup failed', cleanupError);
      }
    }

    return NextResponse.json({ error: getApiErrorMessage(error), stage: createdTenancyId ? 'collection' : 'tenancy' }, { status: 500 });
  }
}
