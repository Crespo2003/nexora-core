import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createPropertyNarrative } from '../lib/property-intelligence/analysis';
import { calculatePropertyIntelligence, estimateTravelMinutes, haversineDistanceKm, median } from '../lib/property-intelligence/calculations';
import type { NearbyPlace, PropertyComparable } from '../lib/property-intelligence/types';

const root = process.cwd();
const comparables: PropertyComparable[] = [
  { comparableType: 'sale', propertyName: 'Sale A', price: 800000, builtUpSqft: 1000, transactionDate: '2026-04-01', sourceName: 'Registry', sourceReference: 'sale-a' },
  { comparableType: 'sale', propertyName: 'Sale B', price: 900000, builtUpSqft: 1000, transactionDate: '2026-05-01', sourceName: 'Registry', sourceReference: 'sale-b' },
  { comparableType: 'rental', propertyName: 'Rental A', rental: 4000, builtUpSqft: 1000, transactionDate: '2026-06-01', sourceName: 'Agency record', sourceReference: 'rent-a' }
];
const nearby: NearbyPlace[] = [
  { category: 'public_transport', name: 'Transit', latitude: 3.15, longitude: 101.71, distanceKm: 0.5, travelTimeMinutes: 5, sourceName: 'Map source' },
  { category: 'school', name: 'School', latitude: 3.16, longitude: 101.72, distanceKm: 1.8, travelTimeMinutes: 8, sourceName: 'Map source' },
  { category: 'shopping_mall', name: 'Mall', latitude: 3.17, longitude: 101.73, distanceKm: 2.8, travelTimeMinutes: 12, sourceName: 'Map source' }
];

test('median handles odd, even and empty evidence sets', () => {
  assert.equal(median([9, 1, 4]), 4);
  assert.equal(median([10, 2, 6, 4]), 5);
  assert.equal(median([]), null);
});

test('property metrics use median comparable PSF and explicit operating assumptions', () => {
  const result = calculatePropertyIntelligence({ builtUpSqft: 1200, purchasePrice: 900000, downPayment: 180000, monthlyOperatingCost: 500, monthlyFinancingCost: 2500, occupancyRate: 95, annualCapitalGrowthRate: 3, latitude: 3.14, longitude: 101.7 }, comparables, nearby);
  assert.equal(result.metrics.estimatedMarketValue, 1020000);
  assert.equal(result.metrics.estimatedMonthlyRental, 4800);
  assert.equal(result.metrics.monthlyCashflow, 1560);
  assert.equal(result.metrics.rentalYield, 5.65);
  assert.equal(result.metrics.marketValueMethod, 'median of 2 sale PSF comparables');
  assert.equal(result.metrics.rentalMethod, 'median of 1 rental PSF comparables');
  assert.ok(result.metrics.annualRoi && result.metrics.annualRoi > 0);
});

test('missing evidence returns null estimates and visible warnings instead of invented values', () => {
  const result = calculatePropertyIntelligence({}, [], []);
  assert.equal(result.metrics.estimatedMarketValue, null);
  assert.equal(result.metrics.estimatedMonthlyRental, null);
  assert.equal(result.metrics.rentalYield, null);
  assert.ok(result.warnings.includes('No verified comparable evidence has been added.'));
  assert.ok(result.score.overall <= 40);
  assert.equal(result.score.dataCompleteness, 0);
});

test('manual estimates are preserved and financial values remain bounded', () => {
  const result = calculatePropertyIntelligence({ estimatedMarketValue: 500000, estimatedMonthlyRental: 2500, downPayment: 100000, occupancyRate: 100, monthlyOperatingCost: 300, monthlyFinancingCost: 1200, annualCapitalGrowthRate: 0 }, [], []);
  assert.equal(result.metrics.estimatedMarketValue, 500000);
  assert.equal(result.metrics.estimatedMonthlyRental, 2500);
  assert.equal(result.metrics.monthlyCashflow, 1000);
  assert.equal(result.metrics.rentalYield, 6);
  for (const value of [result.score.location,result.score.accessibility,result.score.amenities,result.score.rentalDemand,result.score.capitalGrowth,result.score.commercialPotential,result.score.overall]) assert.ok(value >= 0 && value <= 100);
});

test('distance and travel estimates are deterministic', () => {
  const distance = haversineDistanceKm(3.139, 101.6869, 3.1579, 101.7117);
  assert.ok(distance > 3 && distance < 4);
  assert.equal(estimateTravelMinutes(10, 'driving'), 20);
  assert.equal(estimateTravelMinutes(1, 'walking'), 12);
});

test('bilingual analysis falls back safely when AI is not configured', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const result = calculatePropertyIntelligence({ estimatedMarketValue: 500000, estimatedMonthlyRental: 2500 }, [], []);
  const narrative = await createPropertyNarrative({ property_name: 'Verified Property', address: 'Kuala Lumpur' }, result);
  assert.equal(narrative.aiStatus, 'not_configured');
  assert.match(narrative.summaryEn, /Verified Property/);
  assert.match(narrative.summaryZh, /投资评分/);
  assert.match(narrative.investmentOpinionEn, /Verify valuation/);
  if (previous) process.env.OPENAI_API_KEY = previous;
});

test('Sprint 007 migration creates isolated models, constraints and authenticated RLS', () => {
  const sql = readFileSync(join(root, 'supabase/migrations/202607142230_sprint_007_ai_property_intelligence.sql'), 'utf8');
  for (const table of ['property_analyses','property_comparables','property_nearby_places','property_scores']) assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(sql, /tenancy_id uuid references public\.tenancies\(id\) on delete cascade/);
  assert.match(sql, /commercial_listing_id uuid references public\.commercial_listings\(id\) on delete cascade/);
  assert.match(sql, /num_nonnulls\(tenancy_id, commercial_listing_id\) = 1/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.%I from anon, public/);
  assert.match(sql, /public\.is_workspace_member\(workspace_id\)/);
  assert.match(sql, /property_intelligence_cross_workspace_source/);
  assert.match(sql, /property_intelligence_assignee_not_in_workspace/);
  assert.match(sql, /security invoker/);
  assert.doesNotMatch(sql, /security definer/i);
});

test('server routes authenticate writes and keep the OpenAI key server-only', () => {
  const resource = readFileSync(join(root, 'app/api/property-intelligence/[resource]/route.ts'), 'utf8');
  const analyze = readFileSync(join(root, 'app/api/property-intelligence/analyze/route.ts'), 'utf8');
  const client = readFileSync(join(root, 'app/property-intelligence/property-intelligence-workspace.tsx'), 'utf8');
  assert.match(resource, /requireWorkspaceAccess\(\[\.\.\.writeRoles\], request\)/);
  assert.match(resource, /eq\('workspace_id', auth\.workspaceId\)/);
  assert.match(resource, /rejectOversizedRequest/);
  assert.match(analyze, /requireWorkspaceAccess\(\['owner','admin','manager','agent'\], request\)/);
  assert.doesNotMatch(client, /OPENAI_API_KEY|service_role/i);
});

test('production UI does not seed synthetic property, comparable or nearby records', () => {
  const client = readFileSync(join(root, 'app/property-intelligence/property-intelligence-workspace.tsx'), 'utf8');
  assert.doesNotMatch(client, /mockData|fakeData|demoPropert|seededComparable|sampleNearby/);
  assert.match(client, /No sample production records are used/);
  for (const route of ['property-intelligence','property-analysis','property-comparables','property-nearby','property-score','property-map']) assert.ok(readFileSync(join(root, 'app', route, 'page.tsx'), 'utf8').includes('PropertyIntelligenceWorkspace'));
});

