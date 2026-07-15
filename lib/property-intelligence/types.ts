export type PropertySourceType = 'residential_tenancy' | 'commercial_listing';
export type ComparableType = 'sale' | 'rental';
export type NearbyCategory = 'public_transport' | 'school' | 'hospital' | 'shopping_mall' | 'restaurant' | 'petrol_station' | 'other';

export type PropertyComparable = {
  id?: string;
  comparableType: ComparableType;
  propertyName: string;
  price?: number | null;
  rental?: number | null;
  builtUpSqft?: number | null;
  psf?: number | null;
  distanceKm?: number | null;
  transactionDate?: string | null;
  sourceName: string;
  sourceReference?: string;
};

export type NearbyPlace = {
  id?: string;
  category: NearbyCategory;
  name: string;
  latitude: number;
  longitude: number;
  distanceKm?: number | null;
  travelTimeMinutes?: number | null;
  travelMode?: 'driving' | 'walking' | 'transit' | 'cycling';
  sourceName: string;
};

export type PropertyAnalysisInput = {
  estimatedMarketValue?: number | null;
  estimatedMonthlyRental?: number | null;
  purchasePrice?: number | null;
  downPayment?: number | null;
  monthlyOperatingCost?: number | null;
  monthlyFinancingCost?: number | null;
  occupancyRate?: number | null;
  annualCapitalGrowthRate?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  builtUpSqft?: number | null;
};

export type PropertyScore = {
  location: number;
  accessibility: number;
  amenities: number;
  rentalDemand: number;
  capitalGrowth: number;
  commercialPotential: number;
  overall: number;
  dataCompleteness: number;
  rationale: Record<string, string>;
  version: 'property-score-v1';
};

export type PropertyMetrics = {
  estimatedMarketValue: number | null;
  estimatedMonthlyRental: number | null;
  rentalYield: number | null;
  annualRoi: number | null;
  monthlyCashflow: number | null;
  marketValueMethod: string;
  rentalMethod: string;
};

export type PropertyIntelligenceResult = {
  metrics: PropertyMetrics;
  score: PropertyScore;
  warnings: string[];
};

