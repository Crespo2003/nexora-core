import { normalizeIdentification, normalizePersonName } from '../ai/tenancyExtractionContract';
import { normalizePhone } from './phone';

type ContactRole = 'tenant' | 'landlord' | 'witness' | 'agent' | 'law_firm';
type Representation = 'tenant' | 'landlord' | 'both' | 'neutral' | 'unknown';

export type ExtractedContactCandidate = {
  role: ContactRole;
  represents: Representation;
  name: string;
  company: string;
  identification: string;
  identificationType: string;
  companyNumber: string;
  renNumber: string;
  phone: string;
  mobile: string;
  officePhone: string;
  additionalPhones: string[];
  email: string;
  additionalEmails: string[];
  correspondenceAddress: string;
  sourcePage: number | null;
  sourceExcerpt: string;
  confidence: number;
};

type QueryResult<T> = PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>;
type ContactQuery = {
  select(columns: string): ContactQuery;
  eq(column: string, value: unknown): ContactQuery;
  maybeSingle(): QueryResult<Record<string, unknown>>;
  insert(value: Record<string, unknown>): { select(columns: string): { single(): QueryResult<Record<string, unknown>> } };
};
type RoleQuery = {
  select(columns: string): RoleQuery;
  eq(column: string, value: unknown): RoleQuery;
  maybeSingle(): QueryResult<Record<string, unknown>>;
  insert(value: Record<string, unknown>): { select(columns: string): { single(): QueryResult<Record<string, unknown>> } };
};
type TenancyContactQuery = {
  select(columns: string): TenancyContactQuery;
  eq(column: string, value: unknown): TenancyContactQuery;
  maybeSingle(): QueryResult<Record<string, unknown>>;
  insert(value: Record<string, unknown>): PromiseLike<{ error: { code?: string; message?: string } | null }>;
};
export type ContactSyncClient = { from(table: 'contacts'): ContactQuery; from(table: 'contact_roles'): RoleQuery; from(table: 'tenancy_contacts'): TenancyContactQuery };

const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim() : '';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const validRoles = new Set<ContactRole>(['tenant', 'landlord', 'witness', 'agent', 'law_firm']);
const validRepresentation = new Set<Representation>(['tenant', 'landlord', 'both', 'neutral', 'unknown']);

/** Returns contact candidates from the canonical extraction and keeps tenant/landlord fallback contacts explicit. */
export function extractedTenancyContacts(value: unknown): ExtractedContactCandidate[] {
  const root = record(value);
  const fromParty = (role: 'tenant' | 'landlord', partyValue: unknown): ExtractedContactCandidate | null => {
    const party = record(partyValue);
    return candidate({
      role, represents: role, name: party.name, company: party.company, identification: party.ic_passport ?? party.identification,
      identification_type: party.identification_type, company_number: party.company_number, ren_number: party.ren_number,
      phone: party.phone, mobile: party.mobile, office_phone: party.office_phone, additional_phones: party.additional_phones, email: party.email,
      additional_emails: party.additional_emails, correspondence_address: party.correspondence_address, source_page: null, source_excerpt: '', confidence: root.confidence
    });
  };
  const values = [fromParty('tenant', root.tenant), fromParty('landlord', root.landlord)];
  if (Array.isArray(root.contacts)) values.push(...root.contacts.map(candidate));
  const seen = new Set<string>();
  return values.flatMap((item) => {
    if (!item) return [];
    const key = `${item.role}:${item.email || item.phone || item.identification || item.companyNumber || item.name}`.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [item];
  });
}

/** Creates only missing workspace contacts, roles, and tenancy links; existing CRM records are never overwritten. */
export async function syncExtractedTenancyContacts(input: {
  supabase: ContactSyncClient;
  workspaceId: string;
  tenancyId: string;
  extraction: unknown;
}): Promise<{ linked: number; warnings: string[] }> {
  const candidates = extractedTenancyContacts(input.extraction);
  let linked = 0;
  const warnings: string[] = [];
  for (const item of candidates) {
    try {
      const contactId = await findOrCreateContact(input.supabase, input.workspaceId, item);
      const roleId = await findOrCreateRole(input.supabase, input.workspaceId, contactId, item);
      const existingLink = await input.supabase.from('tenancy_contacts').select('id')
        .eq('workspace_id', input.workspaceId).eq('tenancy_id', input.tenancyId).eq('contact_id', contactId).eq('contact_role_id', roleId).maybeSingle();
      if (existingLink.error) throw existingLink.error;
      if (!existingLink.data?.id) {
        const inserted = await input.supabase.from('tenancy_contacts').insert({
          workspace_id: input.workspaceId, tenancy_id: input.tenancyId, contact_id: contactId, contact_role_id: roleId,
          is_primary: item.role === 'tenant' || item.role === 'landlord'
        });
        if (inserted.error) throw inserted.error;
      }
      linked += 1;
    } catch {
      warnings.push(`Could not link extracted ${item.role} contact ${item.name || item.company || 'record'} for review.`);
    }
  }
  return { linked, warnings };
}

function candidate(value: unknown): ExtractedContactCandidate | null {
  const source = record(value);
  const role = text(source.role).toLowerCase() as ContactRole;
  if (!validRoles.has(role)) return null;
  const representsValue = text(source.represents).toLowerCase() as Representation;
  const phone = normalizePhone(text(source.phone));
  const mobileSource = text(source.mobile);
  const mobile = normalizePhone(mobileSource);
  const officeSource = text(source.office_phone);
  const officePhone = normalizePhone(officeSource);
  const additionalPhones = uniquePhones(
    (Array.isArray(source.additional_phones) ? source.additional_phones : []).map((item) => text(item)),
    [phone.normalized, mobile.normalized, officePhone.normalized]
  );
  const email = text(source.email).toLowerCase();
  const additionalEmails = uniqueEmails(
    (Array.isArray(source.additional_emails) ? source.additional_emails : []).map((item) => text(item).toLowerCase()),
    [email]
  );
  const result: ExtractedContactCandidate = {
    role, represents: validRepresentation.has(representsValue) ? representsValue : 'unknown', name: normalizePersonName(source.name),
    company: text(source.company), identification: normalizeIdentification(source.identification ?? source.ic_passport),
    identificationType: text(source.identification_type), companyNumber: normalizeIdentification(source.company_number),
    renNumber: normalizeIdentification(source.ren_number),
    phone: phone.normalized || mobile.normalized || text(source.phone), mobile: mobile.normalized || mobileSource,
    officePhone: officePhone.normalized || officeSource, additionalPhones,
    email, additionalEmails, correspondenceAddress: text(source.correspondence_address),
    sourcePage: Number.isInteger(source.source_page) && Number(source.source_page) > 0 ? Number(source.source_page) : null,
    sourceExcerpt: text(source.source_excerpt).slice(0, 500), confidence: normalizeConfidence(source.confidence)
  };
  return result.name || result.company || result.identification || result.companyNumber || result.phone || result.mobile || result.officePhone || result.email ? result : null;
}

function uniquePhones(values: string[], exclude: string[]): string[] {
  const excluded = new Set(exclude.map((item) => item.replace(/\D/g, '')).filter(Boolean));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const normalized = normalizePhone(raw).normalized || raw;
    const digits = normalized.replace(/\D/g, '');
    if (!digits || excluded.has(digits) || seen.has(digits)) continue;
    seen.add(digits);
    result.push(normalized);
  }
  return result;
}

function uniqueEmails(values: string[], exclude: string[]): string[] {
  const excluded = new Set(exclude.filter(Boolean));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const email of values) {
    if (!email || excluded.has(email) || seen.has(email)) continue;
    seen.add(email);
    result.push(email);
  }
  return result;
}

async function findOrCreateContact(supabase: ContactSyncClient, workspaceId: string, item: ExtractedContactCandidate): Promise<string> {
  let existing: { data: Record<string, unknown> | null; error: { code?: string; message?: string } | null } | null = null;
  if (item.email) existing = await supabase.from('contacts').select('id').eq('workspace_id', workspaceId).eq('email', item.email).maybeSingle();
  if ((!existing || !existing.data) && item.phone) existing = await supabase.from('contacts').select('id').eq('workspace_id', workspaceId).eq('phone_normalized', item.phone).maybeSingle();
  if ((!existing || !existing.data) && item.identification) existing = await supabase.from('contacts').select('id').eq('workspace_id', workspaceId).eq('identification_number', item.identification).maybeSingle();
  if ((!existing || !existing.data) && item.name) existing = await supabase.from('contacts').select('id').eq('workspace_id', workspaceId).eq('full_name', item.name).maybeSingle();
  if ((!existing || !existing.data) && item.company) existing = await supabase.from('contacts').select('id').eq('workspace_id', workspaceId).eq('company_name', item.company).maybeSingle();
  if (existing?.error) throw existing.error;
  if (existing?.data?.id) return String(existing.data.id);
  const phone = normalizePhone(item.phone);
  const created = await supabase.from('contacts').insert({
    workspace_id: workspaceId, contact_type: item.company && !item.name ? 'company' : 'person', full_name: item.name,
    company_name: item.company, identification_number: item.identification, registration_number: item.companyNumber, ren_number: item.renNumber,
    phone_original: item.phone, phone_normalized: phone.normalized || '', phone_country_code: phone.countryCode || '',
    whatsapp_number: phone.whatsappNumber || '', email: item.email, address: item.correspondenceAddress,
    raw_extracted_data: item
  }).select('id').single();
  if (created.error || !created.data?.id) throw created.error ?? new Error('contact-create-failed');
  return String(created.data.id);
}

async function findOrCreateRole(supabase: ContactSyncClient, workspaceId: string, contactId: string, item: ExtractedContactCandidate): Promise<string> {
  const existing = await supabase.from('contact_roles').select('id').eq('workspace_id', workspaceId).eq('contact_id', contactId).eq('role', item.role).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) return String(existing.data.id);
  const created = await supabase.from('contact_roles').insert({
    workspace_id: workspaceId, contact_id: contactId, role: item.role, represents: item.represents, source_page: item.sourcePage,
    source_excerpt: item.sourceExcerpt, confidence: item.confidence, is_primary_contact: item.role === 'tenant' || item.role === 'landlord',
    collection_authorized: item.role === 'tenant', raw_extracted_data: item
  }).select('id').single();
  if (created.error || !created.data?.id) throw created.error ?? new Error('contact-role-create-failed');
  return String(created.data.id);
}

function normalizeConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, parsed > 1 ? parsed : parsed * 100));
}
