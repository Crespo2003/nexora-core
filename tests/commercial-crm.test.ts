import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { explainCommercialMatch } from '../lib/commercial/aiExplanation';
import { filterListingForRole, maskContact } from '../lib/commercial/confidentiality';
import { previewCommercialCsv, toCsv, validateCommercialImportRow } from '../lib/commercial/csv';
import { validateDealStageTransition } from '../lib/commercial/deals';
import { followupBucket, inactivityDays } from '../lib/commercial/followups';
import { matchingWeights, scoreCommercialMatch } from '../lib/commercial/matching';
import { maxCommercialMediaBytes, validateCommercialMedia } from '../lib/commercial/media';
import { canCreateCommercialRecord, canManageAssignedCommercialRecord } from '../lib/commercial/permissions';
import { formatProposalText } from '../lib/commercial/proposals';
import type { CommercialListing, CommercialRequirement } from '../lib/commercial/types';

const root = process.cwd();
const requirement: CommercialRequirement = {
  id: 'requirement-1', title: 'KL restaurant', requirementType: 'restaurant', businessCategory: 'restaurant', transactionType: 'rent',
  preferredLocations: ['KLCC'], excludedLocations: [], minBuiltUp: 1800, maxBuiltUp: 3000, maxRental: 30000,
  frontageRequirement: 20, ceilingHeightRequirement: 10, groundFloorRequired: true, driveThroughRequired: false,
  parkingRequirement: 5, loadingBayRequired: true, threePhaseRequired: true, exhaustRequired: true, greaseTrapRequired: true,
  gasRequired: true, waterRequired: true, signageRequired: true, outdoorAreaRequired: false, swimmingPoolRequired: false,
  commercialZoningRequired: true, commencementTarget: '2026-09-01'
};
const listing: CommercialListing = {
  id: 'listing-1', title: 'KLCC restaurant lot', propertyName: 'Central Retail', propertyType: 'restaurant', transactionType: 'rent',
  state: 'Kuala Lumpur', city: 'Kuala Lumpur', area: 'KLCC', address: '10 Exact Street', concealedAddress: 'KLCC', builtUp: 2200,
  askingRental: 26000, frontage: 25, ceilingHeight: 12, groundFloor: true, corner: true, parking: 10, loadingBay: true,
  threePhaseElectricity: true, exhaust: true, greaseTrap: true, gas: true, water: true, signageExposure: 'main road',
  outdoorArea: false, swimmingPool: false, commercialZoning: true, allowedBusinesses: ['restaurant'], prohibitedBusinesses: [],
  availabilityDate: '2026-08-01', landlordName: 'Private Owner', landlordContact: '0123456789', confidentialityLevel: 'normal',
  assignedUserId: 'agent-1', photoPaths: ['workspace/listing/photo.jpg'], documentPaths: ['workspace/listing/brief.pdf'], notes: 'Private', status: 'active'
};

test('matching weights total 100 and a fully verified listing scores 100', () => {
  assert.equal(Object.values(matchingWeights).reduce((sum, value) => sum + value, 0), 100);
  const result = scoreCommercialMatch(requirement, listing, new Date('2026-07-14'));
  assert.equal(result.overallScore, 100);
  assert.equal(result.recommendationLevel, 'excellent_match');
  assert.deepEqual(result.hardConflicts, []);
});

test('hard disqualifiers are visible and cap the score', () => {
  const result = scoreCommercialMatch({ ...requirement, excludedLocations: ['Excluded Zone'] }, { ...listing, area: 'Excluded Zone', transactionType: 'sale', builtUp: 1000, askingRental: 80000, commercialZoning: false, threePhaseElectricity: false, exhaust: false, greaseTrap: false, status: 'reserved' });
  assert.equal(result.recommendationLevel, 'unsuitable');
  assert.ok(result.overallScore <= 25);
  assert.ok(result.hardConflicts.includes('Wrong transaction type'));
  assert.ok(result.hardConflicts.includes('Insufficient minimum size'));
  assert.ok(result.hardConflicts.includes('Commercial use not permitted'));
});

test('missing listing facts are labelled instead of invented', () => {
  const result = scoreCommercialMatch({ ...requirement, minBuiltUp: null, maxBuiltUp: null, maxRental: null }, { ...listing, builtUp: null, askingRental: null, availabilityDate: null });
  assert.ok(result.missingCriteria.includes('Built-up area'));
  assert.ok(result.missingCriteria.includes('Comparable budget'));
  assert.ok(result.missingCriteria.includes('Availability timing'));
  assert.ok(result.overallScore <= 49);
  assert.match(result.explanation, new RegExp(`^${result.overallScore}/100`));
});

test('budget and score boundary behavior is stable', () => {
  const atBudget = scoreCommercialMatch(requirement, { ...listing, askingRental: requirement.maxRental });
  const overBudget = scoreCommercialMatch(requirement, { ...listing, askingRental: Number(requirement.maxRental) + 1 });
  assert.equal(atBudget.hardConflicts.includes('Impossible budget'), false);
  assert.equal(overBudget.hardConflicts.includes('Impossible budget'), true);
  assert.ok(overBudget.overallScore <= 25);
  assert.equal(overBudget.recommendationLevel, 'unsuitable');
});

test('confidential records hide identity, documents and exact location', () => {
  const filtered = filterListingForRole({ ...listing, confidentialityLevel: 'highly_confidential' }, 'viewer', 'viewer-1');
  assert.equal(filtered.address, 'KLCC');
  assert.equal(filtered.landlordName, '');
  assert.deepEqual(filtered.documentPaths, []);
  assert.equal(filtered.propertyName, '');
  assert.match(maskContact('person@example.com'), /^p\*\*\*@example\.com$/);
});

test('viewer is read-only and agent assignment is enforced by permission helpers', () => {
  assert.equal(canCreateCommercialRecord('viewer', 'listings'), false);
  assert.equal(canCreateCommercialRecord('finance', 'listings'), false);
  assert.equal(canCreateCommercialRecord('finance', 'deals'), true);
  assert.equal(canManageAssignedCommercialRecord('agent', 'agent-1', 'agent-1'), true);
  assert.equal(canManageAssignedCommercialRecord('agent', 'agent-1', 'agent-2'), false);
});

test('follow-up due and inactivity rules are deterministic', () => {
  const now = new Date(2026, 6, 14, 12);
  const yesterday = new Date(2026, 6, 13, 9).toISOString();
  const laterToday = new Date(2026, 6, 14, 18).toISOString();
  const fourteenDaysAgo = new Date(2026, 5, 30, 12).toISOString();
  assert.equal(followupBucket({ dueAt: yesterday, status: 'open' }, now), 'overdue');
  assert.equal(followupBucket({ dueAt: laterToday, status: 'open' }, now), 'today');
  assert.equal(inactivityDays(fourteenDaysAgo, now), 14);
});

test('CSV preview catches duplicates and never commits automatically', () => {
  const preview = previewCommercialCsv('legal_name,registration_number\nAlpha,1\nAlpha,1', ['legal_name'], ['legal_name', 'registration_number']);
  assert.deepEqual(preview.duplicates, [3]);
  assert.equal(preview.errors.length, 0);
});

test('CSV validation preserves source rows and creates downloadable row errors', () => {
  const preview = previewCommercialCsv('title,property_type,transaction_type,asking_rental\nBad,shoplot,rent,-5', ['title','property_type','transaction_type'], ['title']);
  assert.equal(preview.rows[0].__rowNumber, '2');
  assert.deepEqual(validateCommercialImportRow('listings', preview.rows[0]), ['invalid-number:asking_rental']);
  const report = toCsv([{ row: 2, error: '=HYPERLINK("bad")' }], ['row','error']);
  assert.match(report, /'=HYPERLINK/);
});

test('CSV export neutralizes spreadsheet formulas', () => {
  const csv = toCsv([{ name: '=2+2' }, { name: '+SUM(A1:A2)' }, { name: '@cmd' }, { name: '-10' }], ['name']);
  assert.match(csv, /'=2\+2/);
  assert.match(csv, /'\+SUM/);
  assert.match(csv, /'@cmd/);
  assert.match(csv, /'-10/);
});

test('proposal formatting supports English, Simplified Chinese and bilingual output', () => {
  const data = [{ title: listing.title, area: listing.area, builtUp: listing.builtUp, askingRental: listing.askingRental, score: 94 }];
  assert.match(formatProposalText(data, 'en'), /property shortlist/);
  assert.match(formatProposalText(data, 'zh'), /商业物业推荐清单/);
  assert.match(formatProposalText(data, 'bilingual'), /---/);
});

test('deal stage transitions prevent skips, reversals and terminal reopening', () => {
  assert.equal(validateDealStageTransition('enquiry','qualification'), true);
  assert.equal(validateDealStageTransition('enquiry','negotiation'), false);
  assert.equal(validateDealStageTransition('viewing','proposal'), false);
  assert.equal(validateDealStageTransition('completed','handover'), false);
  assert.equal(validateDealStageTransition('negotiation','lost'), true);
});

test('commercial media validation enforces category, signatures and size limits', () => {
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  assert.equal(validateCommercialMedia({ buffer: png, filename:'plan.png', mimeType:'image/png', size:png.length, mediaType:'floor_plan' }), null);
  assert.equal(validateCommercialMedia({ buffer: png, filename:'owner-name.png', mimeType:'image/png', size:maxCommercialMediaBytes+1, mediaType:'property_photo' }), 'file-too-large');
  assert.equal(validateCommercialMedia({ buffer: png, filename:'plan.png', mimeType:'image/png', size:png.length, mediaType:'unknown' }), 'invalid-media-category');
});

test('AI explanation gracefully falls back without a server key', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const deterministic = scoreCommercialMatch(requirement, listing);
  const result = await explainCommercialMatch(deterministic);
  assert.equal(result.status, 'not_configured');
  assert.equal(result.text, deterministic.explanation);
  if (previous) process.env.OPENAI_API_KEY = previous;
});

test('migration creates linked CRM models with workspace RLS and private access controls', () => {
  const sql = readFileSync(join(root, 'supabase/migrations/202607142130_sprint_006_ai_commercial_crm.sql'), 'utf8');
  for (const table of ['commercial_companies','commercial_brands','commercial_contacts','commercial_requirements','commercial_listings','commercial_matches','commercial_deals','commercial_followups']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(sql, /company_id uuid not null references public\.commercial_companies\(id\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /public\.is_workspace_member\(workspace_id\)/);
  assert.match(sql, /revoke all on public\.%I from anon, public/);
  assert.match(sql, /security invoker/);
  assert.equal(sql.match(/security definer/gi)?.length, 1);
  assert.match(sql, /commercial_confidential_listing_summaries/);
  assert.match(sql, /auth\.uid\(\) is null or not public\.is_workspace_member/);
  assert.match(sql, /commercial_cross_workspace_listing/);
  assert.match(sql, /commercial_assignee_not_in_workspace/);
});

test('confirmed import, export and media routes enforce server-side controls', () => {
  const csvRoute = readFileSync(join(root,'app/api/commercial/csv/route.ts'),'utf8');
  const mediaRoute = readFileSync(join(root,'app/api/commercial/media/route.ts'),'utf8');
  const signedRoute = readFileSync(join(root,'app/api/commercial/media/signed-url/route.ts'),'utf8');
  assert.match(csvRoute, /payload\.previewHash !== previewHash/);
  assert.match(csvRoute, /commercial_import_jobs/);
  assert.match(csvRoute, /\.insert\(records\)/);
  assert.match(csvRoute, /import-already-processed/);
  assert.match(csvRoute, /requireWorkspaceAccess\(\['owner', 'admin', 'manager', 'agent', 'finance'\]/);
  assert.match(mediaRoute, /requireWorkspaceAccess\(\['owner','admin','manager','agent'\]/);
  assert.match(mediaRoute, /randomUUID\(\)/);
  assert.doesNotMatch(mediaRoute, /storagePath\s*=.*file\.name/);
  assert.match(signedRoute, /requireWorkspaceAccess/);
  assert.match(signedRoute, /commercial_listing_media/);
});

test('confidential summary and proposal payloads omit protected source fields', () => {
  const migration = readFileSync(join(root,'supabase/migrations/202607142130_sprint_006_ai_commercial_crm.sql'),'utf8');
  const proposalRoute = readFileSync(join(root,'app/api/commercial/proposals/[id]/route.ts'),'utf8');
  const summarySignature = migration.slice(migration.indexOf('commercial_confidential_listing_summaries'), migration.indexOf('revoke all on function public.commercial_confidential_listing_summaries'));
  for (const hidden of ['address','landlord_name','landlord_contact','latitude','longitude','photo_paths','document_paths','notes']) assert.doesNotMatch(summarySignature, new RegExp(`\\b${hidden}\\b`));
  assert.match(proposalRoute, /select\('id,title,property_name,property_type,transaction_type,area,city,built_up/);
  assert.doesNotMatch(proposalRoute, /select\([^\n]*landlord_contact/);
  assert.doesNotMatch(proposalRoute, /select\([^\n]*address/);
});

test('inactive listings are excluded from persisted matching runs', () => {
  const route = readFileSync(join(root,'app/api/commercial/matches/run/route.ts'),'utf8');
  assert.match(route, /\.eq\('status', 'active'\)/);
});

test('commercial production UI contains no seeded or fake records and secret stays server-only', () => {
  const workspace = readFileSync(join(root, 'app/commercial/commercial-workspace.tsx'), 'utf8');
  const ai = readFileSync(join(root, 'lib/commercial/aiExplanation.ts'), 'utf8');
  assert.doesNotMatch(workspace, /J Chicken Holdings|mockData|fakeData|demoListings/);
  assert.doesNotMatch(workspace, /OPENAI_API_KEY/);
  assert.match(ai, /process\.env\.OPENAI_API_KEY/);
});
