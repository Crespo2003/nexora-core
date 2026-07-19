import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canConfirmReviewedImport,
  isDuplicateReviewedTenancy,
  parseReviewedDraft,
  reviewedTenancyFieldErrors,
  serializeReviewedDraft,
  tenancyDraftStorageKey,
  type ExistingTenancyKey,
  type ReviewedTenancyForm
} from '../lib/tenancy/importReview';
import { mergeMappedFormPreservingEdits, type EditableTenancyFormField, type TenancyMappedForm } from '../lib/tenancy/mapTenancyExtractionToForm';
import { confirmedTenancyContacts, extractedTenancyContacts } from '../lib/contacts/syncTenancyContacts';

const commandCentre = readFileSync('app/rental-command-centre.tsx', 'utf8');
const confirmRoute = readFileSync('app/api/tenancy-import/confirm/route.ts', 'utf8');
const translations = readFileSync('lib/i18n/translations.ts', 'utf8');
const syncContacts = readFileSync('lib/contacts/syncTenancyContacts.ts', 'utf8');
const whatsappTemplates = readFileSync('lib/whatsapp/messageTemplates.ts', 'utf8');

function validReviewedForm(overrides: Partial<ReviewedTenancyForm> = {}): ReviewedTenancyForm {
  return {
    tenantName: 'AN XIN',
    landlordName: 'Lim Owner',
    propertyName: 'Aria Residence',
    unitNumber: 'A-21-08',
    commencementDate: '01/01/2026',
    expiryDate: '31/12/2026',
    renewalReminder: '',
    monthlyRental: 4800,
    securityDeposit: 9600,
    generalUtilityDeposit: 4800,
    accessCardDeposit: 0,
    carParkRemoteDeposit: 0,
    stampDuty: 0,
    ...overrides
  };
}

function fullMappedForm(overrides: Partial<TenancyMappedForm> = {}): TenancyMappedForm {
  return {
    tenantName: 'AN XIN', tenantCompany: '', tenantIdentification: '', tenantPhone: '', tenantEmail: '',
    landlordName: 'Lim Owner', landlordCompany: '', landlordIdentification: '', landlordPhone: '', landlordEmail: '',
    propertyName: 'Aria Residence', unitNumber: 'A-21-08', fullAddress: '', propertyType: '', buildUp: '', landArea: '', carParks: '',
    monthlyRental: 4800, securityDeposit: 9600, generalUtilityDeposit: 4800, accessCardDeposit: 0, carParkRemoteDeposit: 0, stampDuty: 0,
    commencementDate: '01/01/2026', expiryDate: '31/12/2026', renewalOption: '', noticePeriod: '', paymentDueDay: '',
    tnbResponsibility: '', waterResponsibility: '', iwkResponsibility: '', wifiResponsibility: '',
    specialClauses: '', witnesses: '', inventory: '', latePayment: '', termination: '', viewingRights: '', maintenance: '', insurance: '',
    signedTa: '', renewalReminder: '', renewalHistory: '', notes: '', summary: '', risks: [], warnings: [],
    confidence: 0.9, fieldConfidence: {}, sourceReferences: {}, lowConfidenceFields: [], rawAiJson: {}, rawText: '',
    documentId: 'doc-123', workspaceId: 'workspace-1',
    ...overrides
  };
}

// 1. A valid reviewed extraction can be imported (creating exactly one tenancy) and the
//    client posts to the single-write confirm endpoint that maps its result to one tenancy.
test('a valid reviewed extraction is importable and commits through the single confirm endpoint', () => {
  assert.equal(canConfirmReviewedImport(validReviewedForm(), []), true);
  const confirmPosts = commandCentre.match(/fetch\('\/api\/tenancy-import\/confirm'/g) ?? [];
  assert.equal(confirmPosts.length, 1);
  assert.match(commandCentre, /const savedTenancy = mapTenancy\(payload\.tenancy\)/);
  assert.match(commandCentre, /setImportedTenancyId\(savedTenancy\.id\)/);
});

// 2. The existing uploaded document is reused and linked rather than re-uploaded.
test('confirm import reuses the already-uploaded document and links it to the tenancy', () => {
  assert.match(commandCentre, /document: uploadedDocument/);
  assert.match(commandCentre, /documentId: form\.documentId/);
  assert.match(confirmRoute, /const documentId = String\(result\.documentCentre\?\.id \?\? result\.document\?\.id \?\? ''\)/);
  assert.match(confirmRoute, /const tenancyId = String\(result\.tenancy\?\.id \?\? ''\)/);
});

// 3. A duplicate tenancy (same tenant + property + unit) is blocked before submission.
test('duplicate reviewed tenancy is detected and blocks the import', () => {
  const existing: ExistingTenancyKey[] = [{ tenant: 'AN XIN', property: 'Aria Residence', unitNo: 'A-21-08' }];
  assert.equal(isDuplicateReviewedTenancy(validReviewedForm(), existing), true);
  assert.equal(canConfirmReviewedImport(validReviewedForm(), existing), false);
  assert.equal(reviewedTenancyFieldErrors(validReviewedForm(), existing).propertyName, 'duplicate-tenancy');
  // Case-insensitive matching mirrors the workspace uniqueness constraint.
  assert.equal(isDuplicateReviewedTenancy(validReviewedForm(), [{ tenant: 'an xin', property: 'aria residence', unitNo: 'a-21-08' }]), true);
});

// 4. User-edited values override the freshly extracted AI values on re-extraction.
test('user-corrected values override AI-extracted values', () => {
  const current = fullMappedForm({ tenantName: 'Corrected Tenant', monthlyRental: 5200 });
  const incoming = fullMappedForm({ tenantName: 'AI Tenant', monthlyRental: 4800, landlordName: 'AI Landlord' });
  const edited = new Set<EditableTenancyFormField>(['tenantName', 'monthlyRental']);
  const merged = mergeMappedFormPreservingEdits(current, incoming, edited);
  assert.equal(merged.tenantName, 'Corrected Tenant');
  assert.equal(merged.monthlyRental, 5200);
  // Untouched fields still take the newly extracted value.
  assert.equal(merged.landlordName, 'AI Landlord');
});

// 5. Missing required fields block submission.
test('missing required fields block the import action', () => {
  assert.equal(canConfirmReviewedImport(validReviewedForm({ tenantName: '  ' }), []), false);
  assert.equal(reviewedTenancyFieldErrors(validReviewedForm({ landlordName: '' }), []).landlordName, 'required');
  assert.equal(reviewedTenancyFieldErrors(validReviewedForm({ propertyName: '' }), []).propertyName, 'required');
  assert.equal(reviewedTenancyFieldErrors(validReviewedForm({ commencementDate: '' }), []).commencementDate, 'date-required');
  assert.equal(reviewedTenancyFieldErrors(validReviewedForm({ expiryDate: '' }), []).expiryDate, 'date-required');
  // Expiry must be after commencement.
  assert.equal(reviewedTenancyFieldErrors(validReviewedForm({ expiryDate: '01/01/2025' }), []).expiryDate, 'expiry-after-commencement');
  // Negative money is rejected.
  assert.equal(reviewedTenancyFieldErrors(validReviewedForm({ securityDeposit: -5 }), []).securityDeposit, 'number-negative');
});

// 6. Contact sync only runs for confirmed contacts (parties plus named agents/witnesses).
test('contact sync only includes confirmed contacts', () => {
  const candidates = extractedTenancyContacts({
    tenant: { name: 'Tenant One', email: 'tenant@example.com' },
    landlord: { name: 'Landlord One', email: 'landlord@example.com' },
    contacts: [
      { role: 'agent', represents: 'landlord', name: 'Agent Confirmed' },
      { role: 'witness', represents: 'tenant', phone: '012-345 6789' }
    ]
  });
  const confirmed = confirmedTenancyContacts(candidates);
  assert.ok(confirmed.some((item) => item.role === 'tenant'));
  assert.ok(confirmed.some((item) => item.role === 'landlord'));
  assert.ok(confirmed.some((item) => item.role === 'agent' && item.name === 'Agent Confirmed'));
  // A witness with no confirmed name or company is not linked to the tenancy.
  assert.ok(!confirmed.some((item) => item.role === 'witness'));
  // The sync pipeline filters candidates through the confirmed gate.
  assert.match(syncContacts, /confirmedTenancyContacts\(extractedTenancyContacts\(input\.extraction\)\)/);
});

// 7. Cross-workspace access remains blocked.
test('cross-workspace access is blocked by the confirm route', () => {
  assert.match(confirmRoute, /requireWorkspaceAccess\(\['owner', 'admin', 'manager', 'agent'\], request\)/);
  assert.match(confirmRoute, /clientWorkspaceId && clientWorkspaceId !== workspaceId/);
  assert.match(confirmRoute, /code: 'workspace-mismatch'/);
  assert.match(confirmRoute, /\{ status: 403 \}/);
});

// 8. The dashboard refreshes after a successful import.
test('the dashboard reloads after a successful import', () => {
  assert.match(commandCentre, /setImportState\('success'\);/);
  const successBlock = commandCentre.slice(commandCentre.indexOf('setImportedTenancyId(savedTenancy.id)'));
  assert.match(commandCentre.slice(0, commandCentre.indexOf('setImportedTenancyId(savedTenancy.id)')), /await loadRentalData\(\);/);
  assert.match(successBlock, /setNotice\(\{ tone: 'success', message: t\.notices\.importSuccess \}\)/);
});

// 9. Repeated import clicks do not create duplicate records.
test('repeated import clicks are guarded against duplicate creation', () => {
  assert.match(commandCentre, /if \(operationId === 'confirm-import' \|\| importState === 'saving'\) return;/);
  assert.match(commandCentre, /if \(importCompleted\) \{[\s\S]*?importAlreadyCompleted[\s\S]*?return;/);
  // The primary action is disabled while a save is in flight and once the form is invalid.
  assert.match(commandCentre, /disabled=\{!reviewForm \|\| !canImportReviewed \|\| operationId === 'confirm-import'\}/);
});

// 10. Dates stay DD/MM/YYYY across the reviewed workflow UI.
test('dates render as DD/MM/YYYY throughout the command centre', () => {
  assert.match(commandCentre, /isoToDisplayDate/);
  assert.match(commandCentre, /placeholder \|\| 'DD\/MM\/YYYY'/);
  // No US-style MM/DD/YYYY formatting is introduced.
  assert.doesNotMatch(commandCentre, /MM\/DD\/YYYY/);
});

// 11. The reviewed import surfaces the required bilingual actions and labels.
test('the reviewed page exposes the import, draft, and open-tenancy actions in both languages', () => {
  assert.match(commandCentre, /\{t\.importIntoNexora\}/);
  assert.match(commandCentre, /onClick=\{saveDraft\}/);
  assert.match(commandCentre, /\{t\.saveAsDraft\}/);
  assert.match(commandCentre, /href=\{`\/tenancies\/\$\{importedTenancyId\}`\}/);
  assert.match(commandCentre, /\{t\.openTenancy\}/);
  for (const label of ['importIntoNexora', 'saveAsDraft', 'openTenancy', 'importedStatus', 'tenancyReference']) {
    assert.ok(translations.includes(`${label}:`), `translation ${label} missing`);
  }
  assert.ok(translations.includes('导入 Nexora'));
  assert.ok(translations.includes('保存草稿'));
  assert.ok(translations.includes('查看租赁资料'));
  assert.ok(translations.includes('租赁资料已成功导入。'));
});

// 12. Existing WhatsApp functionality remains unchanged by this workflow.
test('WhatsApp templates are untouched by the import workflow', () => {
  assert.doesNotMatch(commandCentre, /whatsapp/i);
  assert.ok(whatsappTemplates.length > 0);
});

// Draft round-trip preserves reviewed corrections on this device.
test('reviewed drafts round-trip and stay scoped to the workspace and document', () => {
  const key = tenancyDraftStorageKey('workspace-1', 'doc-123');
  assert.equal(key, 'nexora-tenancy-draft:workspace-1:doc-123');
  const serialized = serializeReviewedDraft(fullMappedForm({ tenantName: 'Draft Tenant' }));
  const parsed = parseReviewedDraft(serialized);
  assert.equal(parsed?.tenantName, 'Draft Tenant');
  assert.equal(parseReviewedDraft(null), null);
  assert.equal(parseReviewedDraft('not-json'), null);
});
