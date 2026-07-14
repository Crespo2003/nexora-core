import { NextResponse } from 'next/server';
import { scoreCommercialMatch } from '../../../../../lib/commercial/matching';
import type { CommercialListing, CommercialRequirement } from '../../../../../lib/commercial/types';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../../lib/supabase/server';

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { requirementId: string };
    if (!payload.requirementId) return NextResponse.json({ success: false, error: 'requirement-required' }, { status: 400 });
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    const [requirement, listings] = await Promise.all([
      auth.supabase.from('commercial_requirements').select('*').eq('id', payload.requirementId).eq('workspace_id', auth.workspaceId).maybeSingle(),
      auth.supabase.from('commercial_listings').select('*').eq('workspace_id', auth.workspaceId).eq('status', 'active').is('deleted_at', null)
    ]);
    if (requirement.error) throw requirement.error;
    if (listings.error) throw listings.error;
    if (!requirement.data) return NextResponse.json({ success: false, error: 'requirement-not-found' }, { status: 404 });
    const requirementModel = mapRequirement(requirement.data as Record<string, unknown>);
    const ranked = (listings.data ?? []).map((row) => {
      const result = scoreCommercialMatch(requirementModel, mapListing(row as Record<string, unknown>));
      return { listing: row, result };
    }).sort((a, b) => b.result.overallScore - a.result.overallScore);
    const savedIds = new Map<string, string>();
    for (const match of ranked) {
      const write = await auth.supabase.from('commercial_matches').upsert({
        workspace_id: auth.workspaceId, requirement_id: payload.requirementId, listing_id: match.listing.id,
        overall_score: match.result.overallScore, category_scores: match.result.categoryScores,
        matched_criteria: match.result.matchedCriteria, missing_criteria: match.result.missingCriteria,
        hard_conflicts: match.result.hardConflicts, warnings: match.result.warnings,
        recommendation_level: match.result.recommendationLevel, explanation: match.result.explanation,
        assigned_user_id: requirement.data.assigned_user_id ?? auth.user.id, created_by: auth.user.id
      }, { onConflict: 'workspace_id,requirement_id,listing_id' }).select('id').single();
      if (write.error) throw write.error;
      savedIds.set(String(match.listing.id), String(write.data.id));
    }
    return NextResponse.json({ success: true, requirementId: payload.requirementId, matches: ranked.map((match) => ({ ...match, result: { ...match.result, matchId: savedIds.get(String(match.listing.id)) } })), scoreVersion: 'deterministic-v1' });
  } catch (error) {
    return NextResponse.json({ success: false, error: getApiErrorMessage(error) }, { status: 500 });
  }
}

function mapRequirement(row: Record<string, unknown>): CommercialRequirement {
  return { id: String(row.id), title: String(row.title), requirementType: String(row.requirement_type), transactionType: row.transaction_type as CommercialRequirement['transactionType'], preferredLocations: row.preferred_locations as string[] ?? [], excludedLocations: row.excluded_locations as string[] ?? [], minBuiltUp: num(row.min_built_up), maxBuiltUp: num(row.max_built_up), maxRental: num(row.max_rental), maxPurchasePrice: num(row.max_purchase_price), frontageRequirement: num(row.frontage_requirement), ceilingHeightRequirement: num(row.ceiling_height_requirement), groundFloorRequired: Boolean(row.ground_floor_required), driveThroughRequired: Boolean(row.drive_through_required), parkingRequirement: num(row.parking_requirement), loadingBayRequired: Boolean(row.loading_bay_required), threePhaseRequired: Boolean(row.three_phase_required), exhaustRequired: Boolean(row.exhaust_required), greaseTrapRequired: Boolean(row.grease_trap_required), gasRequired: Boolean(row.gas_required), waterRequired: Boolean(row.water_required), signageRequired: Boolean(row.signage_required), outdoorAreaRequired: Boolean(row.outdoor_area_required), swimmingPoolRequired: Boolean(row.swimming_pool_required), commercialZoningRequired: Boolean(row.commercial_zoning_required), commencementTarget: row.commencement_target ? String(row.commencement_target) : null };
}
function mapListing(row: Record<string, unknown>): CommercialListing {
  return { id: String(row.id), title: String(row.title), propertyName: String(row.property_name ?? ''), propertyType: String(row.property_type), transactionType: row.transaction_type as CommercialListing['transactionType'], state: String(row.state ?? ''), city: String(row.city ?? ''), area: String(row.area ?? ''), builtUp: num(row.built_up), askingRental: num(row.asking_rental), askingSalePrice: num(row.asking_sale_price), frontage: num(row.frontage), ceilingHeight: num(row.ceiling_height), groundFloor: Boolean(row.ground_floor), corner: Boolean(row.corner), parking: num(row.parking), loadingBay: Boolean(row.loading_bay), threePhaseElectricity: Boolean(row.three_phase_electricity), exhaust: Boolean(row.exhaust), greaseTrap: Boolean(row.grease_trap), gas: Boolean(row.gas), water: Boolean(row.water), signageExposure: String(row.signage_exposure ?? ''), outdoorArea: Boolean(row.outdoor_area), swimmingPool: Boolean(row.swimming_pool), commercialZoning: Boolean(row.commercial_zoning), allowedBusinesses: row.allowed_businesses as string[] ?? [], prohibitedBusinesses: row.prohibited_businesses as string[] ?? [], availabilityDate: row.availability_date ? String(row.availability_date) : null, confidentialityLevel: row.confidentiality_level as CommercialListing['confidentialityLevel'], assignedUserId: row.assigned_user_id ? String(row.assigned_user_id) : null, status: String(row.status) };
}
function num(value: unknown) { const number = value == null ? null : Number(value); return number !== null && Number.isFinite(number) ? number : null; }
