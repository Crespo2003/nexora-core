-- Upload end-to-end persistence repair.
--
-- The production project has the base tenancy tables, but it does not have the
-- historical Sprint 005/009/011/015 RPCs.  This migration deliberately provides
-- one versioned contract for the active upload flow rather than relying on that
-- chain of unavailable functions.  It is additive, tenant-scoped, and safe to
-- run against a populated workspace database.

-- The UI has always accepted TXT agreements.  Keep the database constraint in
-- step with that public contract.
alter table public.tenancy_documents
  drop constraint if exists tenancy_documents_mime_type_valid;

alter table public.tenancy_documents
  add constraint tenancy_documents_mime_type_valid
  check (mime_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ));

-- A tenant/property/unit is only unique within its workspace.  The previous
-- global constraint could incorrectly reject the same tenancy in another
-- workspace, so it cannot safely support the multi-tenant upload flow.
alter table public.tenancies
  drop constraint if exists tenancies_unique_tenant_property_unit;

create unique index if not exists tenancies_workspace_tenant_property_unit_unique
  on public.tenancies (workspace_id, tenant, property, unit_no)
  where workspace_id is not null;

-- A hash is the idempotency key for uploads.  Empty hashes are intentionally not
-- indexed so legacy rows remain valid.
drop index if exists public.documents_document_hash_unique;
create unique index if not exists documents_workspace_document_hash_unique
  on public.documents (workspace_id, document_hash)
  where document_hash is not null and document_hash <> '';

-- Keep all extraction metadata used by the current client available on the
-- existing base tables.  These additions mirror the previously un-applied AI
-- migrations without requiring their old RPC dependencies.
alter table public.tenancies
  add column if not exists tenant_company text not null default '';

alter table public.tenancy_extractions
  add column if not exists risk_analysis jsonb not null default '[]'::jsonb,
  add column if not exists field_confidence jsonb not null default '{}'::jsonb,
  add column if not exists ai_model text not null default '',
  add column if not exists extraction_engine text not null default 'deterministic',
  add column if not exists source_references jsonb not null default '{}'::jsonb,
  add column if not exists user_corrections jsonb not null default '{}'::jsonb;

alter table public.document_extractions
  add column if not exists risk_analysis jsonb not null default '[]'::jsonb,
  add column if not exists field_confidence jsonb not null default '{}'::jsonb,
  add column if not exists ai_model text not null default '',
  add column if not exists extraction_engine text not null default 'deterministic',
  add column if not exists source_references jsonb not null default '{}'::jsonb,
  add column if not exists user_corrections jsonb not null default '{}'::jsonb;

-- Legal intelligence is persisted after the base document, extraction, tenancy,
-- and collection records exist.  A failure in these optional records is isolated
-- inside the RPC so the primary tenancy import remains durable.
create table if not exists public.tenancy_legal_analyses (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  extraction_version text not null default 'upload-end-to-end-v1',
  executive_summary text not null default '',
  provider text not null default '',
  model text not null default '',
  token_usage jsonb not null default '{}'::jsonb,
  estimated_request_cost numeric(14, 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, document_id, extraction_version)
);

create table if not exists public.tenancy_legal_clause_categories (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null,
  label text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, code)
);

create table if not exists public.tenancy_legal_clauses (
  id uuid primary key default extensions.gen_random_uuid(),
  analysis_id uuid not null references public.tenancy_legal_analyses(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  clause_id text not null,
  category text not null,
  title text not null,
  summary text not null default '',
  full_text text not null default '',
  source_page integer check (source_page is null or source_page > 0),
  source_excerpt text not null default '',
  confidence numeric(5, 2) not null default 0 check (confidence between 0 and 100),
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  responsible_party text not null default 'unclear' check (responsible_party in ('tenant', 'landlord', 'both', 'unclear')),
  obligation text not null default '',
  trigger_text text not null default '',
  deadline text not null default '',
  financial_impact text not null default '',
  recommendation text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (analysis_id, clause_id)
);

create table if not exists public.tenancy_legal_risks (
  id uuid primary key default extensions.gen_random_uuid(),
  analysis_id uuid not null references public.tenancy_legal_analyses(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  risk_id text not null,
  rule_id text not null,
  severity text not null check (severity in ('low', 'medium', 'high')),
  category text not null,
  title text not null,
  reason text not null,
  recommendation text not null,
  source_page integer check (source_page is null or source_page > 0),
  source_excerpt text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (analysis_id, rule_id)
);

create index if not exists tenancy_legal_analyses_workspace_document_idx
  on public.tenancy_legal_analyses (workspace_id, document_id);
create index if not exists tenancy_legal_analyses_document_id_idx
  on public.tenancy_legal_analyses (document_id);
create index if not exists tenancy_legal_analyses_tenancy_id_idx
  on public.tenancy_legal_analyses (tenancy_id);
create index if not exists tenancy_legal_clauses_workspace_document_idx
  on public.tenancy_legal_clauses (workspace_id, document_id, category);
create index if not exists tenancy_legal_clauses_document_id_idx
  on public.tenancy_legal_clauses (document_id);
create index if not exists tenancy_legal_risks_workspace_document_idx
  on public.tenancy_legal_risks (workspace_id, document_id, severity);
create index if not exists tenancy_legal_risks_document_id_idx
  on public.tenancy_legal_risks (document_id);

alter table public.tenancy_legal_analyses enable row level security;
alter table public.tenancy_legal_clause_categories enable row level security;
alter table public.tenancy_legal_clauses enable row level security;
alter table public.tenancy_legal_risks enable row level security;

grant select, insert, update, delete on public.tenancy_legal_analyses to authenticated;
grant select, insert, update, delete on public.tenancy_legal_clause_categories to authenticated;
grant select, insert, update, delete on public.tenancy_legal_clauses to authenticated;
grant select, insert, update, delete on public.tenancy_legal_risks to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenancy_legal_analyses' and policyname = 'upload legal analyses read') then
    create policy "upload legal analyses read" on public.tenancy_legal_analyses for select to authenticated using (private.is_workspace_member(workspace_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenancy_legal_analyses' and policyname = 'upload legal analyses write') then
    create policy "upload legal analyses write" on public.tenancy_legal_analyses for all to authenticated using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent'])) with check (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent']));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenancy_legal_clause_categories' and policyname = 'upload legal categories read') then
    create policy "upload legal categories read" on public.tenancy_legal_clause_categories for select to authenticated using (private.is_workspace_member(workspace_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenancy_legal_clause_categories' and policyname = 'upload legal categories write') then
    create policy "upload legal categories write" on public.tenancy_legal_clause_categories for all to authenticated using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent'])) with check (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent']));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenancy_legal_clauses' and policyname = 'upload legal clauses read') then
    create policy "upload legal clauses read" on public.tenancy_legal_clauses for select to authenticated using (private.is_workspace_member(workspace_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenancy_legal_clauses' and policyname = 'upload legal clauses write') then
    create policy "upload legal clauses write" on public.tenancy_legal_clauses for all to authenticated using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent'])) with check (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent']));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenancy_legal_risks' and policyname = 'upload legal risks read') then
    create policy "upload legal risks read" on public.tenancy_legal_risks for select to authenticated using (private.is_workspace_member(workspace_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenancy_legal_risks' and policyname = 'upload legal risks write') then
    create policy "upload legal risks write" on public.tenancy_legal_risks for all to authenticated using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent'])) with check (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent']));
  end if;
end;
$$;

create or replace function public.upload_end_to_end_preserve_failed_upload(
  p_workspace_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_hash text := nullif(p_payload ->> 'documentHash', '');
  v_document public.documents;
  v_extraction public.document_extractions;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not public.has_workspace_role(p_workspace_id, array['owner', 'admin', 'manager', 'agent']) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;
  if v_hash is null then
    raise exception using errcode = '22023', message = 'document_hash_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || v_hash, 0));

  select * into v_document
  from public.documents
  where workspace_id = p_workspace_id and document_hash = v_hash
  for update;

  if v_document.id is null then
    insert into public.documents (
      workspace_id, owner_user_id, original_filename, sanitized_filename,
      storage_bucket, storage_path, mime_type, file_size, document_type,
      upload_status, processing_status, linked_status, document_hash
    ) values (
      p_workspace_id, (select auth.uid()), p_payload ->> 'originalFilename',
      p_payload ->> 'sanitizedFilename', coalesce(p_payload ->> 'storageBucket', 'real-estate-documents'),
      p_payload ->> 'storagePath', p_payload ->> 'mimeType',
      greatest(coalesce((p_payload ->> 'fileSize')::bigint, 0), 0),
      coalesce(nullif(p_payload ->> 'documentType', ''), 'tenancy_agreement'), 'uploaded',
      'extraction_failed', 'unlinked', v_hash
    ) returning * into v_document;
  else
    update public.documents
    set processing_status = 'extraction_failed', updated_at = now()
    where id = v_document.id
    returning * into v_document;
  end if;

  select * into v_extraction
  from public.document_extractions
  where document_id = v_document.id and extraction_version = 'upload-end-to-end-v1'
  order by created_at desc
  limit 1
  for update;

  if v_extraction.id is null then
    insert into public.document_extractions (
      document_id, workspace_id, extraction_version, raw_text, extracted_json,
      confidence_json, ai_summary, extraction_status, extraction_error, started_at, completed_at
    ) values (
      v_document.id, p_workspace_id, 'upload-end-to-end-v1', '', '{}'::jsonb, '{}'::jsonb,
      'Document preserved after extraction failure. Retry processing from Document Centre.',
      'extraction_failed', nullif(p_payload ->> 'processingError', ''), now(), now()
    ) returning * into v_extraction;
  else
    update public.document_extractions
    set extraction_status = 'extraction_failed',
        extraction_error = nullif(p_payload ->> 'processingError', ''),
        completed_at = now(),
        updated_at = now()
    where id = v_extraction.id
    returning * into v_extraction;
  end if;

  insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json, created_by)
  values (
    p_workspace_id, 'document', v_document.id, 'tenancy_upload_extraction_failed',
    jsonb_build_object('documentId', v_document.id, 'extractionId', v_extraction.id), (select auth.uid())::text
  );

  return jsonb_build_object('document', to_jsonb(v_document), 'extraction', to_jsonb(v_extraction), 'idempotentReplay', false);
end;
$$;

revoke all on function public.upload_end_to_end_preserve_failed_upload(uuid, jsonb) from public, anon;
grant execute on function public.upload_end_to_end_preserve_failed_upload(uuid, jsonb) to authenticated;

create or replace function public.upload_end_to_end_import_tenancy(
  p_workspace_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenancy_payload jsonb := p_payload -> 'tenancy';
  v_collection_payload jsonb := p_payload -> 'collection';
  v_document_payload jsonb := p_payload -> 'document';
  v_extraction_payload jsonb := p_payload -> 'extraction';
  v_extracted_json jsonb := coalesce(p_payload -> 'extraction' -> 'extractedJson', '{}'::jsonb);
  v_intelligence jsonb := coalesce(v_extracted_json -> 'legal_intelligence', v_extracted_json, '{}'::jsonb);
  v_hash text := nullif(p_payload -> 'document' ->> 'documentHash', '');
  v_document public.documents;
  v_tenancy public.tenancies;
  v_legacy_document public.tenancy_documents;
  v_legacy_extraction public.tenancy_extractions;
  v_document_extraction public.document_extractions;
  v_collection public.rental_collections;
  v_payment public.collection_payments;
  v_analysis public.tenancy_legal_analyses;
  v_clause jsonb;
  v_risk jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_replay boolean := false;
  v_amount_paid numeric := greatest(coalesce((p_payload -> 'collection' ->> 'amount_paid')::numeric, 0), 0);
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not public.has_workspace_role(p_workspace_id, array['owner', 'admin', 'manager', 'agent']) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;
  if v_tenancy_payload is null or v_collection_payload is null or v_document_payload is null or v_extraction_payload is null then
    raise exception using errcode = '22023', message = 'incomplete tenancy import payload';
  end if;
  if v_hash is null then
    raise exception using errcode = '22023', message = 'document_hash_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || v_hash, 0));

  select * into v_document
  from public.documents
  where workspace_id = p_workspace_id and document_hash = v_hash
  for update;

  if v_document.id is not null then
    select t.* into v_tenancy
    from public.document_links l
    join public.tenancies t on t.id = l.entity_id and t.workspace_id = p_workspace_id
    where l.document_id = v_document.id
      and l.workspace_id = p_workspace_id
      and l.entity_type = 'tenancy'
      and l.link_type = 'source_document'
    limit 1;

    if v_tenancy.id is not null then
      select * into v_legacy_document from public.tenancy_documents
      where tenancy_id = v_tenancy.id and workspace_id = p_workspace_id
      order by uploaded_at asc limit 1;
      select * into v_legacy_extraction from public.tenancy_extractions
      where tenancy_document_id = v_legacy_document.id and workspace_id = p_workspace_id
      order by created_at desc limit 1;
      select * into v_document_extraction from public.document_extractions
      where document_id = v_document.id and workspace_id = p_workspace_id
      order by created_at desc limit 1;
      select * into v_collection from public.rental_collections
      where tenancy_id = v_tenancy.id and workspace_id = p_workspace_id
      order by collection_month asc limit 1;
      select * into v_payment from public.collection_payments
      where rental_collection_id = v_collection.id and workspace_id = p_workspace_id
      order by created_at asc limit 1;

      return jsonb_build_object(
        'tenancy', to_jsonb(v_tenancy),
        'document', to_jsonb(v_legacy_document),
        'documentCentre', to_jsonb(v_document),
        'extraction', to_jsonb(v_legacy_extraction),
        'documentExtraction', to_jsonb(v_document_extraction),
        'collection', to_jsonb(v_collection),
        'payment', case when v_payment.id is null then null else to_jsonb(v_payment) end,
        'legalIntelligence', jsonb_build_object('cached', true),
        'warnings', '[]'::jsonb,
        'idempotentReplay', true
      );
    end if;
  else
    insert into public.documents (
      workspace_id, owner_user_id, original_filename, sanitized_filename,
      storage_bucket, storage_path, mime_type, file_size, document_type,
      upload_status, processing_status, linked_status, document_hash
    ) values (
      p_workspace_id, (select auth.uid()), v_document_payload ->> 'originalFilename',
      regexp_replace(v_document_payload ->> 'storagePath', '^.*/', ''), 'real-estate-documents',
      v_document_payload ->> 'storagePath', v_document_payload ->> 'mimeType',
      greatest(coalesce((v_document_payload ->> 'fileSize')::bigint, 0), 0),
      'tenancy_agreement', coalesce(nullif(v_document_payload ->> 'uploadStatus', ''), 'uploaded'),
      'extracting', 'unlinked', v_hash
    ) returning * into v_document;
  end if;

  if exists (
    select 1 from public.tenancies t
    where t.workspace_id = p_workspace_id
      and lower(btrim(t.tenant)) = lower(btrim(v_tenancy_payload ->> 'tenant'))
      and lower(btrim(t.property)) = lower(btrim(v_tenancy_payload ->> 'property'))
      and lower(btrim(t.unit_no)) = lower(btrim(coalesce(v_tenancy_payload ->> 'unit_no', '')))
  ) then
    raise exception using errcode = '23505', message = 'duplicate tenancy in active workspace';
  end if;

  insert into public.tenancies (
    workspace_id, tenant, tenant_id_no, tenant_phone, tenant_email, tenant_company,
    landlord, landlord_id_no, landlord_phone, landlord_email,
    property, unit_no, property_address, property_type,
    monthly_rental, security_deposit, utility_deposit, access_card_deposit,
    car_park_remote_deposit, commencement_date, expiry_date, renewal_option,
    notice_period, renewal_reminder, signed_ta, renewal_history, special_clauses,
    notes, status, rental_due_day
  ) values (
    p_workspace_id, btrim(v_tenancy_payload ->> 'tenant'), coalesce(v_tenancy_payload ->> 'tenant_id_no', ''),
    coalesce(v_tenancy_payload ->> 'tenant_phone', ''), coalesce(v_tenancy_payload ->> 'tenant_email', ''),
    coalesce(v_tenancy_payload ->> 'tenant_company', ''), btrim(v_tenancy_payload ->> 'landlord'),
    coalesce(v_tenancy_payload ->> 'landlord_id_no', ''), coalesce(v_tenancy_payload ->> 'landlord_phone', ''),
    coalesce(v_tenancy_payload ->> 'landlord_email', ''), btrim(v_tenancy_payload ->> 'property'),
    coalesce(v_tenancy_payload ->> 'unit_no', ''), coalesce(v_tenancy_payload ->> 'property_address', ''),
    coalesce(v_tenancy_payload ->> 'property_type', ''), greatest(coalesce((v_tenancy_payload ->> 'monthly_rental')::numeric, 0), 0),
    greatest(coalesce((v_tenancy_payload ->> 'security_deposit')::numeric, 0), 0),
    greatest(coalesce((v_tenancy_payload ->> 'utility_deposit')::numeric, 0), 0),
    greatest(coalesce((v_tenancy_payload ->> 'access_card_deposit')::numeric, 0), 0),
    greatest(coalesce((v_tenancy_payload ->> 'car_park_remote_deposit')::numeric, 0), 0),
    (v_tenancy_payload ->> 'commencement_date')::date, (v_tenancy_payload ->> 'expiry_date')::date,
    coalesce(v_tenancy_payload ->> 'renewal_option', ''), coalesce(v_tenancy_payload ->> 'notice_period', ''),
    nullif(v_tenancy_payload ->> 'renewal_reminder', '')::date, coalesce(v_tenancy_payload ->> 'signed_ta', ''),
    coalesce(v_tenancy_payload ->> 'renewal_history', ''), coalesce(v_tenancy_payload ->> 'special_clauses', ''),
    coalesce(v_tenancy_payload ->> 'notes', ''), coalesce(nullif(v_tenancy_payload ->> 'status', ''), 'active'),
    greatest(1, least(31, coalesce((v_tenancy_payload ->> 'rental_due_day')::integer, 1)))
  ) returning * into v_tenancy;

  insert into public.tenancy_documents (
    tenancy_id, workspace_id, original_filename, storage_path, mime_type,
    file_size, document_type, upload_status
  ) values (
    v_tenancy.id, p_workspace_id, v_document.original_filename, v_document.storage_path,
    v_document.mime_type, v_document.file_size, 'tenancy_agreement', 'uploaded'
  ) returning * into v_legacy_document;

  insert into public.tenancy_extractions (
    tenancy_document_id, workspace_id, extraction_status, extracted_json, raw_text,
    ai_summary, confidence_json, extraction_error, risk_analysis, field_confidence,
    ai_model, extraction_engine, source_references, user_corrections
  ) values (
    v_legacy_document.id, p_workspace_id, coalesce(v_extraction_payload ->> 'extractionStatus', 'ready'),
    v_extracted_json, coalesce(v_extraction_payload ->> 'rawText', ''),
    coalesce(v_extraction_payload ->> 'aiSummary', ''), coalesce(v_extraction_payload -> 'confidenceJson', '{}'::jsonb),
    nullif(v_extraction_payload ->> 'extractionError', ''), coalesce(v_intelligence -> 'risks', '[]'::jsonb),
    coalesce(v_intelligence -> 'field_confidence', '{}'::jsonb), coalesce(v_extraction_payload ->> 'model', ''),
    coalesce(v_extraction_payload -> 'confidenceJson' ->> 'provider', 'deterministic'),
    coalesce(v_intelligence -> 'field_evidence', '{}'::jsonb),
    coalesce(v_extraction_payload -> 'confidenceJson' -> 'userCorrections', '{}'::jsonb)
  ) returning * into v_legacy_extraction;

  insert into public.document_extractions (
    document_id, workspace_id, extraction_version, raw_text, extracted_json,
    confidence_json, ai_summary, extraction_status, extraction_error, started_at,
    completed_at, risk_analysis, field_confidence, ai_model, extraction_engine,
    source_references, user_corrections
  ) values (
    v_document.id, p_workspace_id, 'upload-end-to-end-v1', coalesce(v_extraction_payload ->> 'rawText', ''),
    v_extracted_json, coalesce(v_extraction_payload -> 'confidenceJson', '{}'::jsonb),
    coalesce(v_extraction_payload ->> 'aiSummary', ''), 'extraction_completed',
    nullif(v_extraction_payload ->> 'extractionError', ''), now(), now(),
    coalesce(v_intelligence -> 'risks', '[]'::jsonb), coalesce(v_intelligence -> 'field_confidence', '{}'::jsonb),
    coalesce(v_extraction_payload ->> 'model', ''), coalesce(v_extraction_payload -> 'confidenceJson' ->> 'provider', 'deterministic'),
    coalesce(v_intelligence -> 'field_evidence', '{}'::jsonb),
    coalesce(v_extraction_payload -> 'confidenceJson' -> 'userCorrections', '{}'::jsonb)
  ) returning * into v_document_extraction;

  insert into public.document_links (document_id, workspace_id, entity_type, entity_id, link_type)
  values (v_document.id, p_workspace_id, 'tenancy', v_tenancy.id, 'source_document');

  update public.documents
  set processing_status = 'extraction_completed', linked_status = 'linked', updated_at = now()
  where id = v_document.id
  returning * into v_document;

  insert into public.rental_collections (
    tenancy_id, workspace_id, collection_month, due_date, rental_amount,
    tnb_amount, water_amount, iwk_amount, wifi_amount, aircond_amount,
    other_charges, amount_paid, payment_status, payment_date, payment_method,
    payment_reference, notes, payment_history
  ) values (
    v_tenancy.id, p_workspace_id, (v_collection_payload ->> 'collection_month')::date,
    (v_collection_payload ->> 'due_date')::date, greatest(coalesce((v_collection_payload ->> 'rental_amount')::numeric, 0), 0),
    greatest(coalesce((v_collection_payload ->> 'tnb_amount')::numeric, 0), 0),
    greatest(coalesce((v_collection_payload ->> 'water_amount')::numeric, 0), 0),
    greatest(coalesce((v_collection_payload ->> 'iwk_amount')::numeric, 0), 0),
    greatest(coalesce((v_collection_payload ->> 'wifi_amount')::numeric, 0), 0),
    greatest(coalesce((v_collection_payload ->> 'aircond_amount')::numeric, 0), 0),
    greatest(coalesce((v_collection_payload ->> 'other_charges')::numeric, 0), 0), v_amount_paid,
    coalesce(v_collection_payload ->> 'payment_status', 'outstanding'), nullif(v_collection_payload ->> 'payment_date', '')::date,
    coalesce(v_collection_payload ->> 'payment_method', ''), coalesce(v_collection_payload ->> 'payment_reference', ''),
    coalesce(v_collection_payload ->> 'notes', ''), coalesce(v_collection_payload -> 'payment_history', '[]'::jsonb)
  ) returning * into v_collection;

  if v_amount_paid > 0 then
    insert into public.collection_payments (
      rental_collection_id, workspace_id, amount, payment_date, payment_method,
      payment_reference, notes, recorded_by, transaction_type
    ) values (
      v_collection.id, p_workspace_id, v_amount_paid,
      coalesce(nullif(v_collection_payload ->> 'payment_date', '')::date, current_date),
      case coalesce(v_collection_payload ->> 'payment_method', '')
        when 'bank_transfer' then 'bank_transfer' when 'cash' then 'cash' when 'duitnow' then 'duitnow'
        when 'touch_n_go' then 'touch_n_go' when 'cheque' then 'cheque' when 'online_banking' then 'online_banking'
        else 'other'
      end,
      coalesce(v_collection_payload ->> 'payment_reference', ''), 'Imported with tenancy agreement',
      (select auth.uid())::text, 'payment'
    ) returning * into v_payment;
  end if;

  -- Optional intelligence is deliberately isolated: base import rows remain
  -- committed even if a malformed optional clause/risk cannot be persisted.
  begin
    insert into public.tenancy_legal_analyses (
      workspace_id, document_id, tenancy_id, extraction_version, executive_summary,
      provider, model, token_usage, estimated_request_cost
    ) values (
      p_workspace_id, v_document.id, v_tenancy.id, 'upload-end-to-end-v1',
      coalesce(v_intelligence ->> 'executive_summary', v_extraction_payload ->> 'aiSummary', ''),
      coalesce(v_extraction_payload -> 'confidenceJson' ->> 'provider', ''),
      coalesce(v_extraction_payload -> 'confidenceJson' ->> 'model', v_extraction_payload ->> 'model', ''),
      coalesce(v_extraction_payload -> 'confidenceJson' -> 'tokenUsage', '{}'::jsonb),
      nullif(v_extraction_payload -> 'confidenceJson' ->> 'estimatedRequestCost', '')::numeric
    ) returning * into v_analysis;

    if jsonb_typeof(v_intelligence -> 'clauses') = 'array' then
      for v_clause in select value from jsonb_array_elements(v_intelligence -> 'clauses') loop
        insert into public.tenancy_legal_clause_categories (workspace_id, code, label)
        values (p_workspace_id, coalesce(v_clause ->> 'category', 'Special conditions'), coalesce(v_clause ->> 'category', 'Special conditions'))
        on conflict (workspace_id, code) do nothing;

        insert into public.tenancy_legal_clauses (
          analysis_id, workspace_id, document_id, clause_id, category, title, summary, full_text,
          source_page, source_excerpt, confidence, risk_level, responsible_party, obligation,
          trigger_text, deadline, financial_impact, recommendation
        ) values (
          v_analysis.id, p_workspace_id, v_document.id, coalesce(nullif(v_clause ->> 'id', ''), md5(v_clause::text)),
          coalesce(v_clause ->> 'category', 'Special conditions'), coalesce(v_clause ->> 'title', 'Legal clause'),
          coalesce(v_clause ->> 'summary', ''), coalesce(v_clause ->> 'full_text', ''),
          nullif(v_clause ->> 'source_page', '')::integer, coalesce(v_clause ->> 'source_excerpt', ''),
          greatest(0, least(100, coalesce((v_clause ->> 'confidence')::numeric, 0))),
          case when v_clause ->> 'risk_level' in ('low', 'medium', 'high') then v_clause ->> 'risk_level' else 'low' end,
          case when v_clause ->> 'responsible_party' in ('tenant', 'landlord', 'both', 'unclear') then v_clause ->> 'responsible_party' else 'unclear' end,
          coalesce(v_clause ->> 'obligation', ''), coalesce(v_clause ->> 'trigger', ''), coalesce(v_clause ->> 'deadline', ''),
          coalesce(v_clause ->> 'financial_impact', ''), coalesce(v_clause ->> 'recommendation', '')
        );
      end loop;
    end if;

    if jsonb_typeof(v_intelligence -> 'risks') = 'array' then
      for v_risk in select value from jsonb_array_elements(v_intelligence -> 'risks') loop
        insert into public.tenancy_legal_risks (
          analysis_id, workspace_id, document_id, risk_id, rule_id, severity, category, title,
          reason, recommendation, source_page, source_excerpt
        ) values (
          v_analysis.id, p_workspace_id, v_document.id, coalesce(nullif(v_risk ->> 'id', ''), md5(v_risk::text)),
          coalesce(nullif(v_risk ->> 'rule_id', ''), md5(v_risk::text)),
          case when v_risk ->> 'severity' in ('low', 'medium', 'high') then v_risk ->> 'severity' else 'medium' end,
          coalesce(v_risk ->> 'category', 'Legal review'), coalesce(v_risk ->> 'title', 'Legal review required'),
          coalesce(v_risk ->> 'reason', ''), coalesce(v_risk ->> 'recommendation', ''),
          nullif(v_risk ->> 'source_page', '')::integer, coalesce(v_risk ->> 'source_excerpt', '')
        );
      end loop;
    end if;
  exception when others then
    v_warnings := v_warnings || jsonb_build_array('legal_intelligence_persistence_failed');
  end;

  insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json, created_by)
  values (
    p_workspace_id, 'tenancy', v_tenancy.id, 'tenancy_upload_imported',
    jsonb_build_object(
      'documentId', v_document.id, 'legacyDocumentId', v_legacy_document.id,
      'extractionId', v_document_extraction.id, 'legacyExtractionId', v_legacy_extraction.id,
      'collectionId', v_collection.id, 'legalWarnings', v_warnings
    ), (select auth.uid())::text
  );

  return jsonb_build_object(
    'tenancy', to_jsonb(v_tenancy),
    'document', to_jsonb(v_legacy_document),
    'documentCentre', to_jsonb(v_document),
    'extraction', to_jsonb(v_legacy_extraction),
    'documentExtraction', to_jsonb(v_document_extraction),
    'collection', to_jsonb(v_collection),
    'payment', case when v_payment.id is null then null else to_jsonb(v_payment) end,
    'legalIntelligence', jsonb_build_object('analysisId', v_analysis.id, 'cached', false),
    'warnings', v_warnings,
    'idempotentReplay', v_replay
  );
end;
$$;

revoke all on function public.upload_end_to_end_import_tenancy(uuid, jsonb) from public, anon;
grant execute on function public.upload_end_to_end_import_tenancy(uuid, jsonb) to authenticated;

-- Existing production deployments call this historical name.  Keep it as a
-- thin, fully-authorized compatibility entry point while the reviewed
-- application branch rolls out.  The active branch calls the versioned upload
-- contract above directly.
create or replace function public.sprint_015_import_tenancy_legal_intelligence(
  p_workspace_id uuid,
  p_payload jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.upload_end_to_end_import_tenancy(p_workspace_id, p_payload);
$$;

revoke all on function public.sprint_015_import_tenancy_legal_intelligence(uuid, jsonb) from public, anon;
grant execute on function public.sprint_015_import_tenancy_legal_intelligence(uuid, jsonb) to authenticated;

-- Make PostgREST discover the newly granted RPCs before the application is
-- deployed.  This is the direct remedy for the existing PGRST202 schema-cache
-- failure and does not modify application data.
notify pgrst, 'reload schema';
