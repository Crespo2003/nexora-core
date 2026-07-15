import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(undefined, request);
    if (auth instanceof Response) return auth;
    const [tenancies, listings] = await Promise.all([
      auth.supabase.from('tenancies').select('id,property,unit_no,property_address,property_type,monthly_rental,status,occupancy_status').eq('workspace_id', auth.workspaceId).order('updated_at', { ascending: false }).limit(500),
      auth.supabase.from('commercial_listings').select('id,title,property_name,address,concealed_address,property_type,built_up,asking_rental,asking_sale_price,latitude,longitude,status,confidentiality_level').eq('workspace_id', auth.workspaceId).is('deleted_at', null).order('updated_at', { ascending: false }).limit(500)
    ]);
    if (tenancies.error) throw tenancies.error;
    if (listings.error && !String(listings.error.message).includes('does not exist')) throw listings.error;
    return NextResponse.json({
      success: true,
      properties: [
        ...(tenancies.data ?? []).map((row) => ({ id: row.id, source: 'residential_tenancy', name: [row.property, row.unit_no].filter(Boolean).join(' - '), address: row.property_address, propertyType: row.property_type, monthlyRental: row.monthly_rental, status: row.occupancy_status || row.status })),
        ...(listings.data ?? []).map((row) => ({ id: row.id, source: 'commercial_listing', name: row.property_name || row.title, address: row.address || row.concealed_address, propertyType: row.property_type, builtUpSqft: row.built_up, monthlyRental: row.asking_rental, purchasePrice: row.asking_sale_price, latitude: row.latitude, longitude: row.longitude, status: row.status }))
      ]
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: getApiErrorMessage(error) }, { status: 500 });
  }
}

