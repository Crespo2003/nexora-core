import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(undefined, request);
    if (auth instanceof Response) return auth;
    const url = new URL(request.url); const entityType=url.searchParams.get('entityType'); const entityId=url.searchParams.get('entityId');
    if(!entityType||!entityId)return NextResponse.json({success:false,error:'entity-required'},{status:400});
    const result=await auth.supabase.from('commercial_activities').select('id,activity_type,activity_json,sensitive_access,created_at').eq('workspace_id',auth.workspaceId).eq('entity_type',entityType).eq('entity_id',entityId).is('deleted_at',null).order('created_at',{ascending:false}).limit(100);
    if(result.error)throw result.error;
    return NextResponse.json({success:true,rows:result.data});
  } catch(error){return NextResponse.json({success:false,error:getApiErrorMessage(error)},{status:500,headers:{'Cache-Control':'private, no-store'}});}
}
