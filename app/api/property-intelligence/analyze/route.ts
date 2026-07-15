import { NextResponse } from 'next/server';
import { createPropertyNarrative } from '../../../../lib/property-intelligence/analysis';
import { calculatePropertyIntelligence } from '../../../../lib/property-intelligence/calculations';
import type { NearbyPlace, PropertyComparable } from '../../../../lib/property-intelligence/types';
import { getApiErrorMessage, rejectOversizedRequest, requireWorkspaceAccess } from '../../../../lib/supabase/server';

export async function POST(request: Request) {
  try {
    const oversized = rejectOversizedRequest(request, 16 * 1024);
    if (oversized) return oversized;
    const auth = await requireWorkspaceAccess(['owner','admin','manager','agent'], request);
    if (auth instanceof Response) return auth;
    const payload = await request.json() as { analysisId?: string };
    if (!payload.analysisId) return NextResponse.json({ success: false, error: 'analysis-id-required' }, { status: 400 });
    const [analysis, comparables, nearby] = await Promise.all([
      auth.supabase.from('property_analyses').select('*').eq('id', payload.analysisId).eq('workspace_id', auth.workspaceId).is('deleted_at', null).maybeSingle(),
      auth.supabase.from('property_comparables').select('*').eq('analysis_id', payload.analysisId).eq('workspace_id', auth.workspaceId).is('deleted_at', null),
      auth.supabase.from('property_nearby_places').select('*').eq('analysis_id', payload.analysisId).eq('workspace_id', auth.workspaceId).is('deleted_at', null)
    ]);
    if (analysis.error) throw analysis.error;
    if (comparables.error) throw comparables.error;
    if (nearby.error) throw nearby.error;
    if (!analysis.data) return NextResponse.json({ success: false, error: 'analysis-not-found' }, { status: 404 });
    const result = calculatePropertyIntelligence({
      estimatedMarketValue: analysis.data.estimated_market_value,
      estimatedMonthlyRental: analysis.data.estimated_monthly_rental,
      purchasePrice: analysis.data.purchase_price,
      downPayment: analysis.data.down_payment,
      monthlyOperatingCost: analysis.data.monthly_operating_cost,
      monthlyFinancingCost: analysis.data.monthly_financing_cost,
      occupancyRate: analysis.data.occupancy_rate,
      annualCapitalGrowthRate: analysis.data.annual_capital_growth_rate,
      latitude: analysis.data.latitude,
      longitude: analysis.data.longitude,
      builtUpSqft: analysis.data.built_up_sqft
    }, (comparables.data ?? []).map(toComparable), (nearby.data ?? []).map(toNearby));
    const narrative = await createPropertyNarrative(analysis.data, result);
    const now = new Date().toISOString();
    const update = await auth.supabase.from('property_analyses').update({
      estimated_market_value: result.metrics.estimatedMarketValue,
      estimated_monthly_rental: result.metrics.estimatedMonthlyRental,
      rental_yield: result.metrics.rentalYield,
      annual_roi: result.metrics.annualRoi,
      monthly_cashflow: result.metrics.monthlyCashflow,
      market_value_method: result.metrics.marketValueMethod,
      rental_method: result.metrics.rentalMethod,
      summary_en: narrative.summaryEn, summary_zh: narrative.summaryZh,
      marketing_description_en: narrative.marketingDescriptionEn, marketing_description_zh: narrative.marketingDescriptionZh,
      strengths_en: narrative.strengthsEn, strengths_zh: narrative.strengthsZh,
      weaknesses_en: narrative.weaknessesEn, weaknesses_zh: narrative.weaknessesZh,
      suitable_tenant_profile_en: narrative.suitableTenantProfileEn, suitable_tenant_profile_zh: narrative.suitableTenantProfileZh,
      suitable_buyer_profile_en: narrative.suitableBuyerProfileEn, suitable_buyer_profile_zh: narrative.suitableBuyerProfileZh,
      commercial_suitability_en: narrative.commercialSuitabilityEn, commercial_suitability_zh: narrative.commercialSuitabilityZh,
      investment_opinion_en: narrative.investmentOpinionEn, investment_opinion_zh: narrative.investmentOpinionZh,
      analysis_status: 'generated', data_quality_score: result.score.dataCompleteness, warnings: result.warnings,
      methodology: { marketValue: result.metrics.marketValueMethod, rental: result.metrics.rentalMethod, scoreVersion: result.score.version },
      ai_model: narrative.aiModel, ai_generated_at: narrative.aiStatus === 'generated' ? now : null
    }).eq('id', payload.analysisId).eq('workspace_id', auth.workspaceId).select('*').single();
    if (update.error) throw update.error;
    const score = await auth.supabase.from('property_scores').upsert({
      workspace_id: auth.workspaceId, analysis_id: payload.analysisId,
      location_score: result.score.location, accessibility_score: result.score.accessibility, amenities_score: result.score.amenities,
      rental_demand_score: result.score.rentalDemand, capital_growth_score: result.score.capitalGrowth, commercial_potential_score: result.score.commercialPotential,
      overall_score: result.score.overall, data_completeness: result.score.dataCompleteness, rationale: result.score.rationale,
      score_version: result.score.version, calculated_at: now, assigned_user_id: analysis.data.assigned_user_id ?? auth.user.id, created_by: auth.user.id, deleted_at: null
    }, { onConflict: 'workspace_id,analysis_id' }).select('*').single();
    if (score.error) throw score.error;
    return NextResponse.json({ success: true, analysis: update.data, score: score.data, aiStatus: narrative.aiStatus });
  } catch (error) {
    return NextResponse.json({ success: false, error: getApiErrorMessage(error) }, { status: 500 });
  }
}

function toComparable(row: Record<string, unknown>): PropertyComparable {
  return { id: String(row.id), comparableType: row.comparable_type as 'sale' | 'rental', propertyName: String(row.property_name), price: asNumber(row.price), rental: asNumber(row.rental), builtUpSqft: asNumber(row.built_up_sqft), psf: asNumber(row.psf), distanceKm: asNumber(row.distance_km), transactionDate: row.transaction_date ? String(row.transaction_date) : null, sourceName: String(row.source_name), sourceReference: String(row.source_reference ?? '') };
}
function toNearby(row: Record<string, unknown>): NearbyPlace {
  return { id: String(row.id), category: row.category as NearbyPlace['category'], name: String(row.name), latitude: Number(row.latitude), longitude: Number(row.longitude), distanceKm: asNumber(row.distance_km), travelTimeMinutes: asNumber(row.travel_time_minutes), travelMode: row.travel_mode as NearbyPlace['travelMode'], sourceName: String(row.source_name) };
}
function asNumber(value: unknown) { return value === null || value === undefined ? null : Number(value); }

