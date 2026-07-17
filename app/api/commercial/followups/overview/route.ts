import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../../lib/supabase/server';
import { addDaysToIsoDate, currentIsoDate } from '../../../../../lib/dates/formatDate';

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(undefined, request);
    if (auth instanceof Response) return auth;
    const now = new Date(); const iso = now.toISOString(); const today = currentIsoDate(now); const week = new Date(now.getTime()+7*86_400_000).toISOString(); const ago7=new Date(now.getTime()-7*86_400_000).toISOString(); const ago14=new Date(now.getTime()-14*86_400_000).toISOString(); const soon30=addDaysToIsoDate(today, 30) ?? today; const verify30=addDaysToIsoDate(today, -30) ?? today;
    const [followups,companies,proposals,viewings,deals,requirements,listings] = await Promise.all([
      auth.supabase.from('commercial_followups').select('*').eq('workspace_id',auth.workspaceId).eq('status','open').is('deleted_at',null).order('due_at'),
      auth.supabase.from('commercial_companies').select('id,legal_name,last_activity_at,updated_at,assigned_user_id').eq('workspace_id',auth.workspaceId).is('deleted_at',null).lt('updated_at',ago7),
      auth.supabase.from('commercial_proposals').select('id,requirement_id,proposed_date,status,updated_at,assigned_user_id').eq('workspace_id',auth.workspaceId).is('deleted_at',null).is('response_date',null).in('status',['draft','prepared','proposed','sent']),
      auth.supabase.from('commercial_viewings').select('id,requirement_id,listing_id,viewing_date,viewing_status,client_feedback,assigned_user_id').eq('workspace_id',auth.workspaceId).is('deleted_at',null).lt('viewing_date',iso).eq('client_feedback',''),
      auth.supabase.from('commercial_deals').select('id,title,stage,updated_at,assigned_user_id').eq('workspace_id',auth.workspaceId).is('deleted_at',null).eq('stage','negotiation').lt('updated_at',ago7),
      auth.supabase.from('commercial_requirements').select('id,title,expiry_date,assigned_user_id').eq('workspace_id',auth.workspaceId).is('deleted_at',null).gte('expiry_date',today).lte('expiry_date',soon30),
      auth.supabase.from('commercial_listings').select('id,title,last_verified_date,confidentiality_level,assigned_user_id').eq('workspace_id',auth.workspaceId).is('deleted_at',null).or(`last_verified_date.is.null,last_verified_date.lte.${verify30}`)
    ]);
    const failed=[followups,companies,proposals,viewings,deals,requirements,listings].find((result)=>result.error); if(failed?.error)throw failed.error;
    const persisted=(followups.data??[]).map((row)=>({...row,bucket:String(row.due_at)<today?'overdue':String(row.due_at).startsWith(today)?'today':String(row.due_at)<=week?'this_week':'upcoming',derived:false}));
    const inactivity=(companies.data??[]).map((row)=>{const activity=String(row.last_activity_at??row.updated_at);const days=activity<=ago14?14:7;return{id:`company-${row.id}-${days}`,bucket:`inactive_${days}`,derived:true,title:row.legal_name,note:`No activity for ${days}+ days`,due_at:activity,company_id:row.id,assigned_user_id:row.assigned_user_id,source_href:`/commercial/companies/${row.id}`};});
    const derived=[...(proposals.data??[]).map((row)=>({id:`proposal-${row.id}`,bucket:'proposal_feedback',derived:true,title:'Proposal awaiting feedback',note:row.status,due_at:row.updated_at,proposal_id:row.id,requirement_id:row.requirement_id,assigned_user_id:row.assigned_user_id,source_href:`/commercial/proposals/${row.id}`})),...(viewings.data??[]).map((row)=>({id:`viewing-${row.id}`,bucket:'viewing_feedback',derived:true,title:'Viewing awaiting feedback',note:row.viewing_status,due_at:row.viewing_date,viewing_id:row.id,requirement_id:row.requirement_id,listing_id:row.listing_id,assigned_user_id:row.assigned_user_id,source_href:'/commercial/matches'})),...(deals.data??[]).map((row)=>({id:`deal-${row.id}`,bucket:'stalled_negotiation',derived:true,title:row.title,note:'Negotiation has no activity for 7+ days',due_at:row.updated_at,deal_id:row.id,assigned_user_id:row.assigned_user_id,source_href:`/commercial/deals/${row.id}`})),...(requirements.data??[]).map((row)=>({id:`requirement-${row.id}`,bucket:'expiring_requirement',derived:true,title:row.title,note:'Requirement expires soon',due_at:row.expiry_date,requirement_id:row.id,assigned_user_id:row.assigned_user_id,source_href:`/commercial/requirements/${row.id}`})),...(listings.data??[]).map((row)=>({id:`listing-${row.id}`,bucket:'listing_reverification',derived:true,title:row.title,note:'Listing verification is due',due_at:row.last_verified_date,listing_id:row.id,assigned_user_id:row.assigned_user_id,source_href:`/commercial/listings/${row.id}`}))];
    return NextResponse.json({success:true,rows:[...persisted,...inactivity,...derived],role:auth.role});
  } catch(error){return NextResponse.json({success:false,error:getApiErrorMessage(error)},{status:500,headers:{'Cache-Control':'private, no-store'}});}
}
