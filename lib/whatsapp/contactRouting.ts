import { isConfirmedCollectionContact, normalizePhone } from '../contacts/phone';

export type WhatsAppRoutingCandidate = {
  contactId?: string;
  name: string;
  role: string;
  represents?: 'tenant' | 'landlord' | 'both' | 'neutral' | 'unknown' | string;
  phone: string;
  isPrimaryTenant?: boolean;
  isTenantCompanyRepresentative?: boolean;
  isConfirmedTenantRepresentative?: boolean;
  isConfirmedTenantAgent?: boolean;
  isManuallySelectedCollectionContact?: boolean;
  collectionAuthorized?: boolean;
};

export type WhatsAppRoutingResult = {
  recommended: WhatsAppRoutingCandidate | null;
  ranked: WhatsAppRoutingCandidate[];
  excluded: WhatsAppRoutingCandidate[];
  warning: string | null;
};

const excludedRoles = new Set(['landlord', 'landlord_agent', 'law_firm']);

function priority(candidate: WhatsAppRoutingCandidate): number {
  if (candidate.isPrimaryTenant) return 1;
  if (candidate.isTenantCompanyRepresentative) return 2;
  if (candidate.isConfirmedTenantRepresentative) return 3;
  if (candidate.isConfirmedTenantAgent) return 4;
  if (candidate.isManuallySelectedCollectionContact) return 5;
  return 99;
}

/**
 * Orders rental-collection contact candidates for WhatsApp outreach: primary tenant, then
 * tenant company representative, confirmed tenant representative, confirmed tenant agent,
 * and finally a manually selected collection contact. Landlord, landlord agent, unconfirmed
 * witnesses, lawyers, and building management are never recommended for tenant debt
 * collection unless explicitly authorized.
 */
export function recommendCollectionContacts(candidates: WhatsAppRoutingCandidate[]): WhatsAppRoutingResult {
  const eligible: WhatsAppRoutingCandidate[] = [];
  const excluded: WhatsAppRoutingCandidate[] = [];

  candidates.forEach((candidate) => {
    const role = String(candidate.role ?? '').toLowerCase();
    const explicitlyAuthorized = Boolean(candidate.collectionAuthorized) || isConfirmedCollectionContact({
      role: candidate.role, represents: candidate.represents, collectionAuthorized: candidate.collectionAuthorized
    });
    if (excludedRoles.has(role) && !explicitlyAuthorized) { excluded.push(candidate); return; }
    if (role === 'witness' && !explicitlyAuthorized) { excluded.push(candidate); return; }
    if (!normalizePhone(candidate.phone).normalized && !normalizePhone(candidate.phone).whatsappNumber) { excluded.push(candidate); return; }
    eligible.push(candidate);
  });

  const ranked = [...eligible].sort((a, b) => priority(a) - priority(b));
  const recommended = ranked[0] ?? null;
  const witnessSelected = recommended ? String(recommended.role ?? '').toLowerCase() === 'witness' : false;

  return {
    recommended,
    ranked,
    excluded,
    warning: witnessSelected
      ? 'This contact is recorded only as a witness. Confirm authorization before using them for collection follow-up.'
      : null
  };
}

/** Standalone check used by the UI before rendering a WhatsApp action for a selected contact. */
export function witnessWarning(candidate: Pick<WhatsAppRoutingCandidate, 'role' | 'represents' | 'collectionAuthorized'>): string | null {
  const role = String(candidate.role ?? '').toLowerCase();
  if (role !== 'witness') return null;
  if (isConfirmedCollectionContact(candidate)) return null;
  return 'This contact is recorded only as a witness, not a confirmed agent or representative.';
}
