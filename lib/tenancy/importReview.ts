import { normalizeDateForStorage } from '../dates/formatDate';
import { editableTenancyFormFields, type TenancyMappedForm } from './mapTenancyExtractionToForm';

/**
 * Pure validation and draft helpers for the reviewed AI tenancy import.
 *
 * These functions gate the "Import into Nexora" action so the reviewed
 * extraction can only be committed to an active tenancy record once every
 * required field is valid. They are deliberately UI-agnostic so both the
 * Rental Command Centre client and the test suite share one source of truth.
 */

export type ReviewedTenancyForm = Pick<
  TenancyMappedForm,
  | 'tenantName'
  | 'landlordName'
  | 'propertyName'
  | 'unitNumber'
  | 'commencementDate'
  | 'expiryDate'
  | 'renewalReminder'
  | 'monthlyRental'
  | 'securityDeposit'
  | 'generalUtilityDeposit'
  | 'accessCardDeposit'
  | 'carParkRemoteDeposit'
  | 'stampDuty'
>;

export type ExistingTenancyKey = {
  tenant: string;
  property: string;
  unitNo: string;
};

export type ReviewedTenancyFieldError =
  | 'required'
  | 'number-invalid'
  | 'number-negative'
  | 'date-required'
  | 'date-invalid'
  | 'expiry-after-commencement'
  | 'reminder-before-expiry'
  | 'reminder-after-commencement'
  | 'duplicate-tenancy';

export const requiredReviewedTenancyFields = [
  'tenantName',
  'landlordName',
  'propertyName',
  'commencementDate',
  'expiryDate'
] as const;

const reviewedMoneyFields = [
  'monthlyRental',
  'securityDeposit',
  'generalUtilityDeposit',
  'accessCardDeposit',
  'carParkRemoteDeposit',
  'stampDuty'
] as const;

function compareIsoDates(left: string, right: string): number | null {
  const leftIso = normalizeDateForStorage(left);
  const rightIso = normalizeDateForStorage(right);
  return leftIso && rightIso ? leftIso.localeCompare(rightIso) : null;
}

/** Case-insensitive tenant + property + unit key that mirrors the workspace uniqueness constraint. */
export function isDuplicateReviewedTenancy(form: ReviewedTenancyForm, existing: ExistingTenancyKey[]): boolean {
  const tenant = form.tenantName.trim().toLowerCase();
  const property = form.propertyName.trim().toLowerCase();
  const unit = form.unitNumber.trim().toLowerCase();
  return existing.some(
    (record) =>
      record.tenant.trim().toLowerCase() === tenant &&
      record.property.trim().toLowerCase() === property &&
      record.unitNo.trim().toLowerCase() === unit
  );
}

/** Returns one error code per invalid field; an empty object means the reviewed form can be imported. */
export function reviewedTenancyFieldErrors(
  form: ReviewedTenancyForm,
  existing: ExistingTenancyKey[] = []
): Partial<Record<keyof ReviewedTenancyForm, ReviewedTenancyFieldError>> {
  const errors: Partial<Record<keyof ReviewedTenancyForm, ReviewedTenancyFieldError>> = {};

  if (!form.tenantName.trim()) errors.tenantName = 'required';
  if (!form.landlordName.trim()) errors.landlordName = 'required';
  if (!form.propertyName.trim()) errors.propertyName = 'required';

  for (const field of reviewedMoneyFields) {
    const amount = Number(form[field]);
    if (!Number.isFinite(amount)) errors[field] = 'number-invalid';
    else if (amount < 0) errors[field] = 'number-negative';
  }

  if (!form.commencementDate) errors.commencementDate = 'date-required';
  else if (!normalizeDateForStorage(form.commencementDate)) errors.commencementDate = 'date-invalid';

  if (!form.expiryDate) errors.expiryDate = 'date-required';
  else if (!normalizeDateForStorage(form.expiryDate)) errors.expiryDate = 'date-invalid';

  if (form.renewalReminder && !normalizeDateForStorage(form.renewalReminder)) errors.renewalReminder = 'date-invalid';

  const termCompare = compareIsoDates(form.expiryDate, form.commencementDate);
  if (termCompare !== null && termCompare <= 0) errors.expiryDate = 'expiry-after-commencement';

  const reminderVsExpiry = form.renewalReminder ? compareIsoDates(form.renewalReminder, form.expiryDate) : null;
  if (reminderVsExpiry !== null && reminderVsExpiry >= 0) errors.renewalReminder = 'reminder-before-expiry';

  const reminderVsStart = form.renewalReminder ? compareIsoDates(form.renewalReminder, form.commencementDate) : null;
  if (reminderVsStart !== null && reminderVsStart < 0) errors.renewalReminder = 'reminder-after-commencement';

  if (isDuplicateReviewedTenancy(form, existing)) errors.propertyName = 'duplicate-tenancy';

  return errors;
}

/** True only when every required tenancy field is valid and no duplicate exists in the workspace. */
export function canConfirmReviewedImport(form: ReviewedTenancyForm, existing: ExistingTenancyKey[] = []): boolean {
  return Object.keys(reviewedTenancyFieldErrors(form, existing)).length === 0;
}

/** Device-local draft key scoped to the workspace and uploaded document so drafts never leak across tenants. */
export function tenancyDraftStorageKey(workspaceId: string, documentId: string): string {
  return `nexora-tenancy-draft:${workspaceId || 'default'}:${documentId || 'pending'}`;
}

/** Serialises only the user-editable reviewed values so a saved draft preserves every correction. */
export function serializeReviewedDraft(form: TenancyMappedForm): string {
  return JSON.stringify(Object.fromEntries(editableTenancyFormFields.map((field) => [field, form[field]])));
}

/** Parses a stored draft back into a partial form patch, returning null for anything unreadable. */
export function parseReviewedDraft(raw: string | null): Partial<TenancyMappedForm> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Partial<TenancyMappedForm>) : null;
  } catch {
    return null;
  }
}
