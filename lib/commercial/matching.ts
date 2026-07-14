import type { CommercialListing, CommercialRequirement, MatchResult, RecommendationLevel } from './types';

export const matchingWeights = { location: 25, size: 20, budget: 15, propertyType: 10, operational: 15, timing: 5, zoning: 5, exposure: 5 } as const;

export function scoreCommercialMatch(requirement: CommercialRequirement, listing: CommercialListing, today = new Date()): MatchResult {
  const scores = { location: 0, size: 0, budget: 0, propertyType: 0, operational: 0, timing: 0, zoning: 0, exposure: 0 };
  const matched: string[] = [];
  const missing: string[] = [];
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const location = `${listing.area ?? ''} ${listing.city ?? ''} ${listing.state ?? ''}`.toLowerCase();
  const preferred = requirement.preferredLocations.map(normalize);
  const excluded = requirement.excludedLocations.map(normalize);

  if (excluded.some((item) => item && location.includes(item))) conflicts.push('Excluded location');
  else if (!preferred.length) { scores.location = 15; missing.push('Preferred location'); }
  else if (preferred.some((item) => location.includes(item))) { scores.location = matchingWeights.location; matched.push('Preferred location'); }
  else warnings.push('Location is outside the preferred areas');

  if (listing.builtUp == null) missing.push('Built-up area');
  else if (requirement.minBuiltUp != null && listing.builtUp < requirement.minBuiltUp) conflicts.push('Insufficient minimum size');
  else if (requirement.maxBuiltUp != null && listing.builtUp > requirement.maxBuiltUp) warnings.push('Built-up exceeds preferred maximum');
  else { scores.size = matchingWeights.size; matched.push('Size range'); }

  const asking = requirement.transactionType === 'sale' ? listing.askingSalePrice : listing.askingRental;
  const maximum = requirement.transactionType === 'sale' ? requirement.maxPurchasePrice : requirement.maxRental;
  if (asking == null || maximum == null) { scores.budget = 8; missing.push('Comparable budget'); }
  else if (asking > maximum) conflicts.push('Impossible budget');
  else { scores.budget = matchingWeights.budget; matched.push('Budget'); }

  if (requirement.transactionType !== 'either' && listing.transactionType !== 'either' && requirement.transactionType !== listing.transactionType) conflicts.push('Wrong transaction type');
  if (normalize(requirement.requirementType) === normalize(listing.propertyType)) { scores.propertyType = matchingWeights.propertyType; matched.push('Property type'); }
  else warnings.push('Property type requires review');

  const prohibited = listing.prohibitedBusinesses.map(normalize);
  if ([requirement.requirementType, requirement.businessCategory ?? ''].map(normalize).some((item) => item && prohibited.includes(item))) conflicts.push('Business use is prohibited');
  if (listing.status !== 'active') conflicts.push('Listing unavailable');

  const operational = [
    criterion(requirement.groundFloorRequired, listing.groundFloor, 'Ground floor', false),
    criterion(requirement.loadingBayRequired, listing.loadingBay, 'Loading bay', false),
    criterion(requirement.threePhaseRequired, listing.threePhaseElectricity, 'Three-phase electricity', true),
    criterion(requirement.exhaustRequired, listing.exhaust, 'Exhaust', true),
    criterion(requirement.greaseTrapRequired, listing.greaseTrap, 'Grease trap', true),
    criterion(requirement.gasRequired, listing.gas, 'Gas', false),
    criterion(requirement.waterRequired, listing.water, 'Water', false),
    criterion(requirement.outdoorAreaRequired, listing.outdoorArea, 'Outdoor area', false),
    criterion(requirement.swimmingPoolRequired, listing.swimmingPool, 'Swimming pool', false)
  ].filter(Boolean) as Array<{ pass: boolean; label: string; hard: boolean }>;
  if (!operational.length) scores.operational = matchingWeights.operational;
  else {
    scores.operational = Math.round(matchingWeights.operational * operational.filter((item) => item.pass).length / operational.length);
    operational.forEach((item) => item.pass ? matched.push(item.label) : item.hard ? conflicts.push(`Required ${item.label} absent`) : warnings.push(`${item.label} requirement not met`));
  }
  if (requirement.frontageRequirement != null) compareMinimum(listing.frontage, requirement.frontageRequirement, 'Frontage', matched, missing, warnings);
  if (requirement.ceilingHeightRequirement != null) compareMinimum(listing.ceilingHeight, requirement.ceilingHeightRequirement, 'Ceiling height', matched, missing, warnings);
  if (requirement.parkingRequirement != null) compareMinimum(listing.parking, requirement.parkingRequirement, 'Parking', matched, missing, warnings);

  if (!requirement.commencementTarget || !listing.availabilityDate) { scores.timing = 3; missing.push('Availability timing'); }
  else if (listing.availabilityDate <= requirement.commencementTarget) { scores.timing = matchingWeights.timing; matched.push('Availability'); }
  else warnings.push('Availability is later than target commencement');

  if (requirement.commercialZoningRequired && !listing.commercialZoning) conflicts.push('Commercial use not permitted');
  else { scores.zoning = matchingWeights.zoning; matched.push('Commercial zoning'); }
  if (listing.signageExposure || listing.corner || listing.groundFloor) { scores.exposure = matchingWeights.exposure; matched.push('Commercial exposure'); }
  else missing.push('Commercial exposure information');

  const rawScore = Object.values(scores).reduce((sum, value) => sum + value, 0);
  const criticalMissing = Number(missing.includes('Built-up area')) + Number(missing.includes('Comparable budget'));
  const confidenceAdjustedScore = criticalMissing >= 2 ? Math.min(rawScore, 49) : criticalMissing === 1 ? Math.min(rawScore, 69) : rawScore;
  const overallScore = conflicts.length ? Math.min(confidenceAdjustedScore, 25) : confidenceAdjustedScore;
  const recommendationLevel = recommendation(overallScore, conflicts.length);
  return {
    overallScore, categoryScores: scores, matchedCriteria: unique(matched), missingCriteria: unique(missing), hardConflicts: unique(conflicts), warnings: unique(warnings), recommendationLevel,
    explanation: conflicts.length ? `Unsuitable at ${overallScore}/100 due to: ${unique(conflicts).join(', ')}.` : `${overallScore}/100. Strongest fit: ${unique(matched).slice(0, 4).join(', ') || 'insufficient verified data'}.${criticalMissing ? ' Critical size or budget information remains unverified.' : ''}`
  };
}

function normalize(value: string) { return value.trim().toLowerCase().replace(/[ _-]+/g, ' '); }
function unique(values: string[]) { return Array.from(new Set(values)); }
function criterion(required: boolean, available: boolean, label: string, hard: boolean) { return required ? { pass: available, label, hard } : null; }
function compareMinimum(actual: number | null | undefined, expected: number, label: string, matched: string[], missing: string[], warnings: string[]) {
  if (actual == null) missing.push(label); else if (actual >= expected) matched.push(label); else warnings.push(`${label} below requirement`);
}
function recommendation(score: number, conflictCount: number): RecommendationLevel {
  if (conflictCount) return 'unsuitable';
  if (score >= 85) return 'excellent_match';
  if (score >= 70) return 'strong_match';
  if (score >= 50) return 'possible_match';
  if (score >= 30) return 'weak_match';
  return 'unsuitable';
}
