import type { NearbyPlace, PropertyAnalysisInput, PropertyComparable, PropertyIntelligenceResult, PropertyScore } from './types';

const scoreWeights = { location: 20, accessibility: 15, amenities: 15, rentalDemand: 20, capitalGrowth: 20, commercialPotential: 10 } as const;

export function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

export function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function haversineDistanceKm(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusKm = 6371;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(longitudeDelta / 2) ** 2;
  return Math.round(earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 100) / 100;
}

export function estimateTravelMinutes(distanceKm: number, mode: NearbyPlace['travelMode'] = 'driving') {
  const speed = { driving: 30, walking: 5, transit: 20, cycling: 15 }[mode ?? 'driving'];
  return Math.max(1, Math.round(distanceKm / speed * 60));
}

export function calculatePropertyIntelligence(
  input: PropertyAnalysisInput,
  comparables: PropertyComparable[],
  nearby: NearbyPlace[]
): PropertyIntelligenceResult {
  const builtUp = positive(input.builtUpSqft);
  const salePsfs = comparables
    .filter((row) => row.comparableType === 'sale')
    .map((row) => positive(row.psf) ?? (positive(row.price) && positive(row.builtUpSqft) ? Number(row.price) / Number(row.builtUpSqft) : null))
    .filter((value): value is number => value !== null);
  const rentalPsfs = comparables
    .filter((row) => row.comparableType === 'rental')
    .map((row) => positive(row.psf) ?? (positive(row.rental) && positive(row.builtUpSqft) ? Number(row.rental) / Number(row.builtUpSqft) : null))
    .filter((value): value is number => value !== null);

  const saleMedian = median(salePsfs);
  const rentalMedian = median(rentalPsfs);
  const comparableValue = saleMedian && builtUp ? saleMedian * builtUp : null;
  const comparableRental = rentalMedian && builtUp ? rentalMedian * builtUp : null;
  const marketValue = positive(input.estimatedMarketValue) ?? roundMoney(comparableValue);
  const monthlyRental = positive(input.estimatedMonthlyRental) ?? roundMoney(comparableRental);
  const occupancyRate = clamp(Number(input.occupancyRate ?? 100), 0, 100) / 100;
  const monthlyCashflow = monthlyRental === null ? null : roundMoney(monthlyRental * occupancyRate - Number(input.monthlyOperatingCost ?? 0) - Number(input.monthlyFinancingCost ?? 0));
  const rentalYield = marketValue && monthlyRental ? roundPercent(monthlyRental * 12 / marketValue * 100) : null;
  const cashInvested = positive(input.downPayment) ?? positive(input.purchasePrice) ?? marketValue;
  const annualRoi = cashInvested && monthlyCashflow !== null
    ? roundPercent((monthlyCashflow * 12 + (marketValue ?? 0) * Number(input.annualCapitalGrowthRate ?? 0) / 100) / cashInvested * 100)
    : null;

  const score = calculatePropertyScore(input, comparables, nearby, rentalYield);
  const warnings: string[] = [];
  if (!comparables.length) warnings.push('No verified comparable evidence has been added.');
  if (!nearby.length) warnings.push('No nearby-place evidence has been added.');
  if (!builtUp) warnings.push('Built-up area is required for PSF-based estimates.');
  if (marketValue === null) warnings.push('Estimated market value is unavailable.');
  if (monthlyRental === null) warnings.push('Estimated monthly rental is unavailable.');

  return {
    metrics: {
      estimatedMarketValue: marketValue,
      estimatedMonthlyRental: monthlyRental,
      rentalYield,
      annualRoi,
      monthlyCashflow,
      marketValueMethod: positive(input.estimatedMarketValue) ? 'user-provided estimate' : saleMedian ? `median of ${salePsfs.length} sale PSF comparables` : 'insufficient evidence',
      rentalMethod: positive(input.estimatedMonthlyRental) ? 'user-provided estimate' : rentalMedian ? `median of ${rentalPsfs.length} rental PSF comparables` : 'insufficient evidence'
    },
    score,
    warnings
  };
}

function calculatePropertyScore(input: PropertyAnalysisInput, comparables: PropertyComparable[], nearby: NearbyPlace[], rentalYield: number | null): PropertyScore {
  const categoryCount = new Set(nearby.map((place) => place.category)).size;
  const closePlaces = nearby.filter((place) => Number(place.distanceKm ?? Infinity) <= 3).length;
  const transport = nearby.filter((place) => place.category === 'public_transport');
  const verifiedComparables = comparables.filter((row) => row.sourceName && row.transactionDate);
  const hasCoordinates = validCoordinate(input.latitude, input.longitude);
  const growth = Number(input.annualCapitalGrowthRate ?? 0);

  const location = clamp((hasCoordinates ? 45 : 20) + Math.min(categoryCount * 8, 40) + Math.min(closePlaces * 3, 15));
  const accessibility = clamp((hasCoordinates ? 30 : 10) + Math.min(transport.length * 20, 50) + Math.min(nearby.filter((p) => Number(p.travelTimeMinutes ?? Infinity) <= 15).length * 4, 20));
  const amenities = clamp(15 + Math.min(categoryCount * 12, 60) + Math.min(closePlaces * 4, 25));
  const rentalDemand = clamp(20 + (rentalYield === null ? 0 : Math.min(rentalYield * 8, 55)) + Math.min(comparables.filter((r) => r.comparableType === 'rental').length * 5, 25));
  const capitalGrowth = clamp(25 + Math.min(verifiedComparables.filter((r) => r.comparableType === 'sale').length * 8, 40) + clamp(growth, 0, 10) * 3.5);
  const commercialPotential = clamp(20 + Math.min(transport.length * 15, 30) + Math.min(nearby.filter((p) => ['shopping_mall','restaurant'].includes(p.category)).length * 8, 40) + (hasCoordinates ? 10 : 0));
  const raw = { location, accessibility, amenities, rentalDemand, capitalGrowth, commercialPotential };
  const fields = [hasCoordinates, positive(input.builtUpSqft) !== null, positive(input.purchasePrice) !== null || positive(input.estimatedMarketValue) !== null, positive(input.estimatedMonthlyRental) !== null, comparables.length >= 3, nearby.length >= 3];
  const dataCompleteness = Math.round(fields.filter(Boolean).length / fields.length * 100);
  const weighted = Object.entries(scoreWeights).reduce((total, [key, weight]) => total + raw[key as keyof typeof raw] * weight / 100, 0);
  const overall = Math.round(Math.min(weighted, 40 + dataCompleteness * .6));
  return {
    ...Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Math.round(value)])) as Omit<PropertyScore, 'overall' | 'dataCompleteness' | 'rationale' | 'version'>,
    overall,
    dataCompleteness,
    rationale: {
      location: hasCoordinates ? 'Coordinates and nearby category coverage.' : 'Limited by missing coordinates.',
      accessibility: `${transport.length} public transport place(s) supplied.`,
      amenities: `${categoryCount} amenity categories and ${closePlaces} places within 3 km.`,
      rentalDemand: rentalYield === null ? 'Limited by missing rental-yield evidence.' : `Based on ${rentalYield}% gross yield and rental comparables.`,
      capitalGrowth: `${verifiedComparables.length} dated comparable(s) and supplied growth assumption.`,
      commercialPotential: 'Transport, retail, restaurant and coordinate evidence.'
    },
    version: 'property-score-v1'
  };
}

function positive(value: number | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function validCoordinate(latitude?: number | null, longitude?: number | null) {
  return Number.isFinite(Number(latitude)) && Number(latitude) >= -90 && Number(latitude) <= 90
    && Number.isFinite(Number(longitude)) && Number(longitude) >= -180 && Number(longitude) <= 180;
}

function roundMoney(value: number | null) { return value === null ? null : Math.round(value * 100) / 100; }
function roundPercent(value: number) { return Math.round(value * 100) / 100; }

