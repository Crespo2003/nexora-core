-- Sprint 005 final blocker remediation.
-- Keeps storage private, scopes uniqueness by workspace, and moves dependent
-- database writes into SECURITY INVOKER transactions protected by existing RLS.

-- Earlier indexes could reject equal identifiers owned by different workspaces.
drop index if exists public.documents_document_hash_unique;
create unique index if not exists documents_workspace_hash_unique
  on public.documents (workspace_id, document_hash)
  where document_hash is not null and document_hash <> '';

drop index if exists public.utility_accounts_provider_account_normalized_unique;
drop index if exists public.utility_accounts_provider_account_unique;
create unique index if not exists utility_accounts_workspace_provider_normalized_unique
  on public.utility_accounts (workspace_id, provider, account_number_normalized)
  where account_number_normalized <> '';

drop index if exists public.utility_bills_provider_bill_unique;
create unique index if not exists utility_bills_workspace_provider_bill_unique
  on public.utility_bills (workspace_id, provider, bill_number)
  where bill_number <> '';

create unique index if not exists collection_followups_workspace_collection_unique
  on public.collection_followups (workspace_id, rental_collection_id);

-- This inputless bootstrap probe deliberately returns one boolean and no row data.
-- Anonymous execution is required by the pre-login setup screen; authenticated and
-- PUBLIC execution are unnecessary.
alter function public.workspace_setup_open() security definer;
alter function public.workspace_setup_open() set search_path = pg_catalog, public;
revoke all on function public.workspace_setup_open() from public, authenticated;
grant execute on function public.workspace_setup_open() to anon;

-- First-workspace bootstrap must bypass RLS exactly once. Its body authenticates
-- auth.uid(), validates inputs, serializes callers with an advisory transaction
-- lock, and refuses execution after the first workspace exists.
alter function public.bootstrap_first_workspace(text, text, text, text) security definer;
alter function public.bootstrap_first_workspace(text, text, text, text) set search_path = pg_catalog, public;
revoke all on function public.bootstrap_first_workspace(text, text, text, text) from public, anon;
grant execute on function public.bootstrap_first_workspace(text, text, text, text) to authenticated;

-- These private helpers avoid recursive workspace_members RLS evaluation. They
-- compare auth.uid() to an active membership and expose no row data.
alter function private.is_workspace_member(uuid) set search_path = pg_catalog, public;
alter function private.has_workspace_role(uuid, text[]) set search_path = pg_catalog, public;
revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.has_workspace_role(uuid, text[]) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.has_workspace_role(uuid, text[]) to authenticated;

-- Only bootstrap_first_workspace calls this migration helper under its own
-- transaction. It is not directly executable by an API role.
alter function public.assign_beta_rows_to_workspace(uuid) set search_path = pg_catalog, public;
revoke all on function public.assign_beta_rows_to_workspace(uuid) from public, anon, authenticated;

-- The diagnostic does not need elevated table privileges. Running as the caller
-- keeps workspace rows subject to RLS while its internal owner/admin check remains.
alter function public.sprint_004_system_check(uuid) security invoker;
alter function public.sprint_004_system_check(uuid) set search_path = pg_catalog, public;
revoke all on function public.sprint_004_system_check(uuid) from public, anon;
grant execute on function public.sprint_004_system_check(uuid) to authenticated;

create or replace function public.sprint_005_create_document_bundle(
  p_workspace_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  document_row public.documents;
  extraction_row public.document_extractions;
  tenancy_id uuid := nullif(p_payload ->> 'tenancyId', '')::uuid;
begin
  if not public.has_workspace_role(p_workspace_id, array['owner','admin','manager','agent','finance']) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;
  if tenancy_id is not null and not exists (
    select 1 from public.tenancies where id = tenancy_id and workspace_id = p_workspace_id
  ) then
    raise exception using errcode = 'P0002', message = 'tenancy not found';
  end if;

  insert into public.documents (
    workspace_id, owner_user_id, original_filename, sanitized_filename,
    storage_bucket, storage_path, mime_type, file_size, document_type,
    upload_status, processing_status, linked_status, document_hash,
    processing_attempts, last_processing_error, processing_started_at
  ) values (
    p_workspace_id, auth.uid(), p_payload ->> 'originalFilename', p_payload ->> 'sanitizedFilename',
    p_payload ->> 'storageBucket', p_payload ->> 'storagePath', p_payload ->> 'mimeType',
    (p_payload ->> 'fileSize')::bigint, p_payload ->> 'documentType', 'uploaded',
    p_payload ->> 'processingStatus', case when tenancy_id is null then 'unlinked' else 'linked' end,
    p_payload ->> 'documentHash', coalesce((p_payload ->> 'processingAttempts')::integer, 0),
    coalesce(p_payload ->> 'processingError', ''), now()
  ) returning * into document_row;

  insert into public.document_extractions (
    document_id, workspace_id, extraction_version, raw_text, extracted_json,
    confidence_json, ai_summary, extraction_status, extraction_error,
    started_at, completed_at
  ) values (
    document_row.id, p_workspace_id, 'fallback-v1', coalesce(p_payload ->> 'rawText', ''),
    coalesce(p_payload -> 'extractedJson', '{}'::jsonb), coalesce(p_payload -> 'confidenceJson', '{}'::jsonb),
    coalesce(p_payload ->> 'aiSummary', ''), p_payload ->> 'processingStatus',
    nullif(p_payload ->> 'processingError', ''), now(), now()
  ) returning * into extraction_row;

  if tenancy_id is not null then
    insert into public.document_links (document_id, workspace_id, entity_type, entity_id, link_type)
    values (document_row.id, p_workspace_id, 'tenancy', tenancy_id, 'source_document');

    insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json)
    values (
      p_workspace_id, 'document', document_row.id, 'document_uploaded',
      jsonb_build_object('tenancyId', tenancy_id, 'filename', document_row.original_filename, 'documentType', document_row.document_type)
    );
    if document_row.processing_status = 'pending_review' then
      insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json)
      values (
        p_workspace_id, 'document', document_row.id, 'extraction_completed',
        jsonb_build_object('tenancyId', tenancy_id, 'lowConfidenceFields', coalesce(p_payload -> 'lowConfidenceFields', '[]'::jsonb))
      );
    end if;
  end if;

  insert into public.document_activity (document_id, workspace_id, activity_type, activity_json)
  values (
    document_row.id, p_workspace_id,
    case when document_row.processing_status = 'pending_review' then 'extraction_completed' else 'extraction_failed' end,
    jsonb_build_object('filename', document_row.original_filename, 'extractionStatus', document_row.processing_status, 'tenancyId', tenancy_id)
  );

  return jsonb_build_object('document', to_jsonb(document_row), 'extraction', to_jsonb(extraction_row));
end;
$$;

create or replace function public.sprint_005_save_extraction_review(
  p_workspace_id uuid,
  p_tenancy_id uuid,
  p_extraction_id uuid,
  p_extracted_json jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  document_id uuid;
begin
  if not public.has_workspace_role(p_workspace_id, array['owner','admin','manager','agent']) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;
  select e.document_id into document_id
  from public.document_extractions e
  join public.document_links l on l.document_id = e.document_id
  where e.id = p_extraction_id and e.workspace_id = p_workspace_id
    and l.workspace_id = p_workspace_id and l.entity_type = 'tenancy' and l.entity_id = p_tenancy_id
  for update of e;
  if document_id is null then raise exception using errcode = 'P0002', message = 'extraction not found'; end if;

  update public.document_extractions
  set extracted_json = p_extracted_json, extraction_status = 'pending_review',
      ai_summary = 'Corrections saved; confirmation pending.'
  where id = p_extraction_id and workspace_id = p_workspace_id;

  insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json)
  values (p_workspace_id, 'document', document_id, 'extraction_corrected', jsonb_build_object('tenancyId', p_tenancy_id, 'confirmed', false));

  return jsonb_build_object('extractionId', p_extraction_id, 'documentId', document_id);
end;
$$;

create or replace function public.sprint_005_confirm_tenancy_extraction(
  p_workspace_id uuid,
  p_tenancy_id uuid,
  p_extraction_id uuid,
  p_changes jsonb,
  p_extracted_json jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  document_id uuid;
  document_type text;
  updated_tenancy public.tenancies;
begin
  if not public.has_workspace_role(p_workspace_id, array['owner','admin','manager','agent']) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;
  select e.document_id, d.document_type into document_id, document_type
  from public.document_extractions e
  join public.documents d on d.id = e.document_id and d.workspace_id = p_workspace_id
  join public.document_links l on l.document_id = e.document_id
  where e.id = p_extraction_id and e.workspace_id = p_workspace_id
    and l.workspace_id = p_workspace_id and l.entity_type = 'tenancy' and l.entity_id = p_tenancy_id
  for update of e, d;
  if document_id is null or document_type <> 'tenancy_agreement' then
    raise exception using errcode = 'P0002', message = 'tenancy extraction not found';
  end if;

  update public.tenancies t set
    property = case when p_changes ? 'property' then p_changes ->> 'property' else t.property end,
    unit_no = case when p_changes ? 'unit_no' then p_changes ->> 'unit_no' else t.unit_no end,
    property_address = case when p_changes ? 'property_address' then p_changes ->> 'property_address' else t.property_address end,
    property_type = case when p_changes ? 'property_type' then p_changes ->> 'property_type' else t.property_type end,
    landlord = case when p_changes ? 'landlord' then p_changes ->> 'landlord' else t.landlord end,
    landlord_id_no = case when p_changes ? 'landlord_id_no' then p_changes ->> 'landlord_id_no' else t.landlord_id_no end,
    landlord_phone = case when p_changes ? 'landlord_phone' then p_changes ->> 'landlord_phone' else t.landlord_phone end,
    landlord_email = case when p_changes ? 'landlord_email' then p_changes ->> 'landlord_email' else t.landlord_email end,
    tenant = case when p_changes ? 'tenant' then p_changes ->> 'tenant' else t.tenant end,
    tenant_id_no = case when p_changes ? 'tenant_id_no' then p_changes ->> 'tenant_id_no' else t.tenant_id_no end,
    tenant_phone = case when p_changes ? 'tenant_phone' then p_changes ->> 'tenant_phone' else t.tenant_phone end,
    tenant_email = case when p_changes ? 'tenant_email' then p_changes ->> 'tenant_email' else t.tenant_email end,
    monthly_rental = case when p_changes ? 'monthly_rental' then (p_changes ->> 'monthly_rental')::numeric else t.monthly_rental end,
    security_deposit = case when p_changes ? 'security_deposit' then (p_changes ->> 'security_deposit')::numeric else t.security_deposit end,
    utility_deposit = case when p_changes ? 'utility_deposit' then (p_changes ->> 'utility_deposit')::numeric else t.utility_deposit end,
    access_card_deposit = case when p_changes ? 'access_card_deposit' then (p_changes ->> 'access_card_deposit')::numeric else t.access_card_deposit end,
    car_park_remote_deposit = case when p_changes ? 'car_park_remote_deposit' then (p_changes ->> 'car_park_remote_deposit')::numeric else t.car_park_remote_deposit end,
    commencement_date = case when p_changes ? 'commencement_date' then (p_changes ->> 'commencement_date')::date else t.commencement_date end,
    expiry_date = case when p_changes ? 'expiry_date' then (p_changes ->> 'expiry_date')::date else t.expiry_date end,
    rental_due_day = case when p_changes ? 'rental_due_day' then (p_changes ->> 'rental_due_day')::integer else t.rental_due_day end,
    renewal_option = case when p_changes ? 'renewal_option' then p_changes ->> 'renewal_option' else t.renewal_option end,
    notice_period = case when p_changes ? 'notice_period' then p_changes ->> 'notice_period' else t.notice_period end,
    special_clauses = case when p_changes ? 'special_clauses' then p_changes ->> 'special_clauses' else t.special_clauses end
  where t.id = p_tenancy_id and t.workspace_id = p_workspace_id
  returning * into updated_tenancy;
  if updated_tenancy.id is null then raise exception using errcode = 'P0002', message = 'tenancy not found'; end if;

  update public.document_extractions set
    extracted_json = p_extracted_json, extraction_status = 'extraction_completed',
    ai_summary = 'Reviewed and confirmed in AI Tenancy Workspace.', completed_at = now()
  where id = p_extraction_id and workspace_id = p_workspace_id;
  update public.documents set processing_status = 'extraction_completed'
  where id = document_id and workspace_id = p_workspace_id;
  insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json)
  values (p_workspace_id, 'document', document_id, 'extraction_confirmed', jsonb_build_object('tenancyId', p_tenancy_id, 'fields', coalesce((select jsonb_agg(key) from jsonb_object_keys(p_changes) key), '[]'::jsonb)));

  return jsonb_build_object('tenancy', to_jsonb(updated_tenancy), 'extractionId', p_extraction_id, 'documentId', document_id);
end;
$$;

create or replace function public.sprint_005_record_collection_transaction(
  p_workspace_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  collection_row public.rental_collections;
  payment_row public.collection_payments;
  paid numeric;
  credit numeric;
  status text;
  transaction_type text := coalesce(p_payload ->> 'transactionType', 'payment');
begin
  if not public.has_workspace_role(p_workspace_id, array['owner','admin','manager','finance']) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;
  if transaction_type not in ('payment','advance_payment','adjustment','waiver','refund','reversal') then
    raise exception using errcode = '22023', message = 'unsupported transaction type';
  end if;
  select * into collection_row from public.rental_collections
  where id = (p_payload ->> 'rentalCollectionId')::uuid and workspace_id = p_workspace_id for update;
  if collection_row.id is null then raise exception using errcode = 'P0002', message = 'collection not found'; end if;

  insert into public.collection_payments (
    rental_collection_id, workspace_id, amount, payment_date, payment_method,
    payment_reference, receipt_number, notes, recorded_by, transaction_type
  ) values (
    collection_row.id, p_workspace_id, (p_payload ->> 'amount')::numeric,
    (p_payload ->> 'paymentDate')::date, p_payload ->> 'paymentMethod',
    coalesce(p_payload ->> 'paymentReference', ''), coalesce(p_payload ->> 'receiptNumber', ''),
    coalesce(p_payload ->> 'notes', ''), coalesce(p_payload ->> 'recordedBy', ''), transaction_type
  ) returning * into payment_row;

  select greatest(coalesce(sum(case
    when transaction_type in ('payment','advance_payment') then amount
    when transaction_type in ('refund','reversal') then -amount
    else 0 end), 0), 0)
  into paid from public.collection_payments
  where rental_collection_id = collection_row.id and workspace_id = p_workspace_id;
  credit := greatest(paid - collection_row.total_due, 0);
  status := case when paid >= collection_row.total_due then 'paid' when paid > 0 then 'partial'
    when collection_row.due_date < current_date then 'overdue' else 'outstanding' end;

  update public.rental_collections set amount_paid = paid, overpayment_credit = credit,
    payment_status = status, payment_date = (p_payload ->> 'paymentDate')::date,
    payment_method = p_payload ->> 'paymentMethod', payment_reference = coalesce(p_payload ->> 'paymentReference', '')
  where id = collection_row.id and workspace_id = p_workspace_id returning * into collection_row;

  insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json)
  values (p_workspace_id, 'rental_collection', collection_row.id,
    case when transaction_type = 'reversal' then 'payment_reversed' when transaction_type = 'refund' then 'payment_refunded' else 'payment_recorded' end,
    jsonb_build_object('tenancyId', collection_row.tenancy_id, 'paymentId', payment_row.id, 'amount', payment_row.amount, 'transactionType', transaction_type, 'credit', credit));

  return jsonb_build_object('payment', to_jsonb(payment_row), 'collection', to_jsonb(collection_row),
    'amountPaid', paid, 'outstanding', greatest(collection_row.total_due - paid, 0), 'credit', credit, 'status', status);
end;
$$;

create or replace function public.sprint_005_confirm_utility_bill(
  p_workspace_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  tenancy_row public.tenancies;
  account_row public.utility_accounts;
  collection_row public.rental_collections;
  bill_row public.utility_bills;
  account_number text := coalesce(p_payload ->> 'accountNumber', '');
  normalized_account text := regexp_replace(lower(coalesce(p_payload ->> 'accountNumber', '')), '[^a-z0-9]', '', 'g');
  provider_name text := p_payload ->> 'provider';
  total_amount numeric := (p_payload ->> 'totalAmountDue')::numeric;
  target_month date := (coalesce(nullif(left(p_payload ->> 'collectionMonth', 7), ''), nullif(left(p_payload ->> 'billDate', 7), ''), to_char(current_date, 'YYYY-MM')) || '-01')::date;
  requested_collection_id uuid := nullif(p_payload ->> 'rentalCollectionId', '')::uuid;
  v_document_id uuid := nullif(p_payload ->> 'documentId', '')::uuid;
  v_extraction_id uuid := nullif(p_payload ->> 'extractionId', '')::uuid;
  collection_created boolean := false;
begin
  if not public.has_workspace_role(p_workspace_id, array['owner','admin','manager','agent','finance']) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;
  if provider_name not in ('tnb','water','iwk','wifi','aircond','other') or total_amount < 0 then
    raise exception using errcode = '22023', message = 'invalid utility bill';
  end if;
  select * into tenancy_row from public.tenancies
  where id = (p_payload ->> 'tenancyId')::uuid and workspace_id = p_workspace_id for update;
  if tenancy_row.id is null then raise exception using errcode = 'P0002', message = 'tenancy not found'; end if;
  if v_document_id is not null and not exists (
    select 1 from public.documents where id = v_document_id and workspace_id = p_workspace_id
  ) then raise exception using errcode = 'P0002', message = 'document not found'; end if;

  if nullif(p_payload ->> 'billNumber', '') is not null and exists (
    select 1 from public.utility_bills where workspace_id = p_workspace_id
      and provider = provider_name and bill_number = p_payload ->> 'billNumber'
  ) then raise exception using errcode = '23505', message = 'duplicate utility bill'; end if;
  if nullif(p_payload ->> 'billNumber', '') is null and normalized_account <> '' and exists (
    select 1 from public.utility_bills b
    join public.utility_accounts a on a.id = b.utility_account_id
    where b.workspace_id = p_workspace_id and b.provider = provider_name
      and a.workspace_id = p_workspace_id and a.account_number_normalized = normalized_account
      and b.total_amount_due = total_amount
      and (nullif(left(p_payload ->> 'billMonth', 7), '') is null
        or b.billing_period_start = (left(p_payload ->> 'billMonth', 7) || '-01')::date)
  ) then raise exception using errcode = '23505', message = 'duplicate utility bill'; end if;

  if normalized_account <> '' then
    select * into account_row from public.utility_accounts
    where workspace_id = p_workspace_id and provider = provider_name
      and account_number_normalized = normalized_account for update;
    if account_row.id is not null and account_row.tenancy_id is not null and account_row.tenancy_id <> tenancy_row.id then
      raise exception using errcode = '42501', message = 'utility account belongs to another tenancy';
    end if;
    if account_row.id is null then
      insert into public.utility_accounts (
        tenancy_id, workspace_id, provider, account_number, account_number_normalized,
        account_number_masked, meter_number, registered_name, billing_address, account_status
      ) values (
        tenancy_row.id, p_workspace_id, provider_name, account_number, normalized_account,
        case when length(account_number) <= 4 then repeat('*', length(account_number))
          else repeat('*', greatest(length(account_number) - 4, 4)) || right(account_number, 4) end,
        coalesce(p_payload ->> 'meterNumber', ''), coalesce(p_payload ->> 'registeredName', ''),
        coalesce(p_payload ->> 'billingAddress', ''), 'active'
      ) returning * into account_row;
    else
      update public.utility_accounts set tenancy_id = tenancy_row.id,
        meter_number = coalesce(nullif(p_payload ->> 'meterNumber', ''), meter_number),
        registered_name = coalesce(nullif(p_payload ->> 'registeredName', ''), registered_name),
        billing_address = coalesce(nullif(p_payload ->> 'billingAddress', ''), billing_address)
      where id = account_row.id and workspace_id = p_workspace_id returning * into account_row;
    end if;
  end if;

  if requested_collection_id is not null then
    select * into collection_row from public.rental_collections
    where id = requested_collection_id and tenancy_id = tenancy_row.id and workspace_id = p_workspace_id for update;
    if collection_row.id is null then raise exception using errcode = 'P0002', message = 'collection not found'; end if;
  else
    select * into collection_row from public.rental_collections
    where tenancy_id = tenancy_row.id and workspace_id = p_workspace_id and collection_month = target_month for update;
  end if;

  if collection_row.id is null and coalesce((p_payload ->> 'createCollectionIfMissing')::boolean, true) then
    insert into public.rental_collections (
      tenancy_id, workspace_id, collection_month, due_date, rental_amount, payment_status
    ) values (
      tenancy_row.id, p_workspace_id, target_month,
      target_month + (least(greatest(tenancy_row.rental_due_day, 1), 28) - 1),
      tenancy_row.monthly_rental, 'pending'
    ) returning * into collection_row;
    collection_created := true;
  end if;

  insert into public.utility_bills (
    utility_account_id, workspace_id, tenancy_id, rental_collection_id, document_id,
    provider, bill_number, billing_period_start, billing_period_end, bill_date, due_date,
    total_amount_due, extracted_json, confidence_json, review_status,
    raw_extracted_text, source_filename
  ) values (
    account_row.id, p_workspace_id, tenancy_row.id, collection_row.id, v_document_id,
    provider_name, coalesce(p_payload ->> 'billNumber', ''),
    case when nullif(left(p_payload ->> 'billMonth', 7), '') is null then null else (left(p_payload ->> 'billMonth', 7) || '-01')::date end,
    case when nullif(left(p_payload ->> 'billMonth', 7), '') is null then null else ((left(p_payload ->> 'billMonth', 7) || '-01')::date + interval '1 month - 1 day')::date end,
    nullif(p_payload ->> 'billDate', '')::date, nullif(p_payload ->> 'dueDate', '')::date,
    total_amount, coalesce(p_payload -> 'extractedJson', '{}'::jsonb),
    coalesce(p_payload -> 'confidenceJson', '{}'::jsonb), 'confirmed',
    coalesce(p_payload ->> 'rawExtractedText', ''), coalesce(p_payload ->> 'sourceFilename', '')
  ) returning * into bill_row;

  if collection_row.id is not null then
    update public.rental_collections set
      tnb_amount = case when provider_name = 'tnb' then total_amount else tnb_amount end,
      water_amount = case when provider_name = 'water' then total_amount else water_amount end,
      iwk_amount = case when provider_name = 'iwk' then total_amount else iwk_amount end,
      wifi_amount = case when provider_name = 'wifi' then total_amount else wifi_amount end,
      aircond_amount = case when provider_name = 'aircond' then total_amount else aircond_amount end,
      other_charges = case when provider_name = 'other' then total_amount else other_charges end
    where id = collection_row.id and workspace_id = p_workspace_id returning * into collection_row;
    if collection_created then
      insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json)
      values (p_workspace_id, 'rental_collection', collection_row.id, 'collection_generated',
        jsonb_build_object('tenancyId', tenancy_row.id, 'collectionMonth', to_char(target_month, 'YYYY-MM'), 'source', 'utility_bill'));
    end if;
  end if;

  if v_extraction_id is not null then
    if not exists (
      select 1 from public.document_extractions
      where id = v_extraction_id and document_id = v_document_id and workspace_id = p_workspace_id
    ) then raise exception using errcode = 'P0002', message = 'extraction not found'; end if;
    update public.document_extractions set extracted_json = coalesce(p_payload -> 'extractedJson', extracted_json),
      extraction_status = 'extraction_completed', ai_summary = 'Reviewed and confirmed in AI Tenancy Workspace.', completed_at = now()
    where id = v_extraction_id and workspace_id = p_workspace_id;
    update public.documents set processing_status = 'extraction_completed'
    where id = v_document_id and workspace_id = p_workspace_id;
  end if;

  insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json)
  values (p_workspace_id, 'utility_bill', bill_row.id, 'utility_updated',
    jsonb_build_object('tenancyId', tenancy_row.id, 'provider', provider_name, 'collectionId', collection_row.id, 'accountId', account_row.id, 'billNumber', bill_row.bill_number));
  if v_extraction_id is not null then
    insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json)
    values (p_workspace_id, 'document', v_document_id, 'extraction_confirmed', jsonb_build_object('tenancyId', tenancy_row.id, 'utilityBillId', bill_row.id));
  end if;

  return jsonb_build_object('utilityBill', to_jsonb(bill_row), 'utilityAccountId', account_row.id,
    'rentalCollectionId', collection_row.id, 'documentId', v_document_id, 'extractionId', v_extraction_id);
end;
$$;

create or replace function public.sprint_005_upsert_utility_account(
  p_workspace_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  account_row public.utility_accounts;
  account_id uuid := nullif(p_payload ->> 'id', '')::uuid;
  tenancy_id uuid := nullif(p_payload ->> 'tenancyId', '')::uuid;
  next_number text;
  normalized text;
  changed boolean := false;
begin
  if not public.has_workspace_role(p_workspace_id, array['owner','admin','manager','agent']) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;
  if tenancy_id is not null and not exists (
    select 1 from public.tenancies where id = tenancy_id and workspace_id = p_workspace_id
  ) then raise exception using errcode = 'P0002', message = 'tenancy not found'; end if;

  if account_id is null then
    if p_payload ->> 'provider' not in ('tnb','water','iwk','wifi','aircond','other') or nullif(p_payload ->> 'accountNumber', '') is null then
      raise exception using errcode = '22023', message = 'invalid utility account';
    end if;
    next_number := p_payload ->> 'accountNumber';
    normalized := regexp_replace(lower(next_number), '[^a-z0-9]', '', 'g');
    insert into public.utility_accounts (
      tenancy_id, workspace_id, provider, account_number, account_number_normalized,
      account_number_masked, meter_number, registered_name, billing_address,
      recurring_fee, notes, account_status
    ) values (
      tenancy_id, p_workspace_id, p_payload ->> 'provider', next_number, normalized,
      case when length(next_number) <= 4 then repeat('*', length(next_number)) else repeat('*', greatest(length(next_number) - 4, 4)) || right(next_number, 4) end,
      coalesce(p_payload ->> 'meterNumber', ''), coalesce(p_payload ->> 'registeredName', ''),
      coalesce(p_payload ->> 'billingAddress', ''), coalesce((p_payload ->> 'recurringFee')::numeric, 0),
      coalesce(p_payload ->> 'notes', ''), 'active'
    ) returning * into account_row;
    insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json)
    values (p_workspace_id, 'utility_account', account_row.id, 'utility_account_created', jsonb_build_object('provider', account_row.provider));
  else
    select * into account_row from public.utility_accounts where id = account_id and workspace_id = p_workspace_id for update;
    if account_row.id is null then raise exception using errcode = 'P0002', message = 'utility account not found'; end if;
    next_number := coalesce(nullif(p_payload ->> 'accountNumber', ''), account_row.account_number);
    changed := next_number <> account_row.account_number;
    if changed then
      insert into public.utility_account_history (
        utility_account_id, workspace_id, tenancy_id, provider, previous_account_number,
        previous_account_number_masked, changed_to_account_number, change_reason
      ) values (
        account_row.id, p_workspace_id, account_row.tenancy_id, account_row.provider,
        account_row.account_number, account_row.account_number_masked, next_number, 'manual-account-update'
      );
    end if;
    normalized := regexp_replace(lower(next_number), '[^a-z0-9]', '', 'g');
    update public.utility_accounts set
      account_number = next_number, account_number_normalized = normalized,
      account_number_masked = case when length(next_number) <= 4 then repeat('*', length(next_number)) else repeat('*', greatest(length(next_number) - 4, 4)) || right(next_number, 4) end,
      account_status = coalesce(nullif(p_payload ->> 'accountStatus', ''), case when changed then 'changed' else account_status end),
      meter_number = coalesce(p_payload ->> 'meterNumber', meter_number),
      registered_name = coalesce(p_payload ->> 'registeredName', registered_name),
      billing_address = coalesce(p_payload ->> 'billingAddress', billing_address),
      notes = coalesce(p_payload ->> 'notes', notes)
    where id = account_row.id and workspace_id = p_workspace_id returning * into account_row;
    insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json)
    values (p_workspace_id, 'utility_account', account_row.id,
      case when changed then 'utility_account_changed' else 'utility_account_updated' end,
      jsonb_build_object('accountChanged', changed));
  end if;
  return jsonb_build_object('utilityAccount', to_jsonb(account_row), 'accountChanged', changed);
end;
$$;

create or replace function public.sprint_005_generate_collection(p_workspace_id uuid, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare collection_row public.rental_collections;
begin
  if not public.has_workspace_role(p_workspace_id, array['owner','admin','manager','finance']) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;
  if not exists (select 1 from public.tenancies where id = (p_payload ->> 'tenancyId')::uuid and workspace_id = p_workspace_id) then
    raise exception using errcode = 'P0002', message = 'tenancy not found';
  end if;
  insert into public.rental_collections (
    tenancy_id, workspace_id, collection_month, due_date, rental_amount, tnb_amount,
    water_amount, iwk_amount, wifi_amount, aircond_amount, other_charges,
    late_charges, adjustments, payment_status, notes
  ) values (
    (p_payload ->> 'tenancyId')::uuid, p_workspace_id, (p_payload ->> 'collectionMonth')::date,
    (p_payload ->> 'dueDate')::date, (p_payload ->> 'rentalAmount')::numeric,
    coalesce((p_payload ->> 'tnbAmount')::numeric, 0), coalesce((p_payload ->> 'waterAmount')::numeric, 0),
    coalesce((p_payload ->> 'iwkAmount')::numeric, 0), coalesce((p_payload ->> 'wifiAmount')::numeric, 0),
    coalesce((p_payload ->> 'aircondAmount')::numeric, 0), coalesce((p_payload ->> 'otherCharges')::numeric, 0),
    0, 0, p_payload ->> 'paymentStatus', 'Generated by monthly workflow.'
  ) returning * into collection_row;
  insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json)
  values (p_workspace_id, 'rental_collection', collection_row.id, 'collection_generated',
    jsonb_build_object('tenancyId', collection_row.tenancy_id, 'collectionMonth', left(collection_row.collection_month::text, 7)));
  return jsonb_build_object('collection', to_jsonb(collection_row));
end;
$$;

create or replace function public.sprint_005_log_collection_reminder(p_workspace_id uuid, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare reminder_row public.collection_reminders;
begin
  if not public.has_workspace_role(p_workspace_id, array['owner','admin','manager','agent','finance']) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;
  if not exists (select 1 from public.rental_collections where id = (p_payload ->> 'rentalCollectionId')::uuid and workspace_id = p_workspace_id) then
    raise exception using errcode = 'P0002', message = 'collection not found';
  end if;
  insert into public.collection_reminders (
    rental_collection_id, workspace_id, reminder_type, language, message_text, sent_status, sent_at, channel
  ) values (
    (p_payload ->> 'rentalCollectionId')::uuid, p_workspace_id, p_payload ->> 'reminderType',
    p_payload ->> 'language', p_payload ->> 'messageText', p_payload ->> 'sentStatus',
    case when p_payload ->> 'sentStatus' = 'sent' then now() else null end,
    coalesce(p_payload ->> 'channel', 'whatsapp')
  ) returning * into reminder_row;
  insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json)
  values (p_workspace_id, 'rental_collection', reminder_row.rental_collection_id,
    case when reminder_row.sent_status = 'sent' then 'reminder_marked_sent' else 'reminder_generated' end,
    jsonb_build_object('reminderId', reminder_row.id, 'reminderType', reminder_row.reminder_type, 'language', reminder_row.language));
  return jsonb_build_object('reminder', to_jsonb(reminder_row));
end;
$$;

create or replace function public.sprint_005_save_collection_followup(p_workspace_id uuid, p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare followup_row public.collection_followups;
declare action_name text := p_payload ->> 'action';
begin
  if not public.has_workspace_role(p_workspace_id, array['owner','admin','manager','agent']) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;
  if action_name not in ('contacted','snoozed','promise_to_pay','escalated','closed') then
    raise exception using errcode = '22023', message = 'invalid follow-up action';
  end if;
  if not exists (select 1 from public.rental_collections where id = (p_payload ->> 'rentalCollectionId')::uuid and workspace_id = p_workspace_id) then
    raise exception using errcode = 'P0002', message = 'collection not found';
  end if;
  insert into public.collection_followups (
    rental_collection_id, workspace_id, followup_status, recommended_action,
    snoozed_until, promise_to_pay_date, last_contacted_at, notes
  ) values (
    (p_payload ->> 'rentalCollectionId')::uuid, p_workspace_id, action_name, action_name,
    case when action_name = 'snoozed' then coalesce(nullif(p_payload ->> 'snoozedUntil', '')::date, current_date + 1) else null end,
    case when action_name = 'promise_to_pay' then coalesce(nullif(p_payload ->> 'promiseToPayDate', '')::date, current_date + 1) else null end,
    case when action_name = 'contacted' then now() else null end, coalesce(p_payload ->> 'notes', '')
  ) on conflict (workspace_id, rental_collection_id) do update set
    followup_status = excluded.followup_status, recommended_action = excluded.recommended_action,
    snoozed_until = excluded.snoozed_until, promise_to_pay_date = excluded.promise_to_pay_date,
    last_contacted_at = excluded.last_contacted_at, notes = excluded.notes
  returning * into followup_row;
  insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json)
  values (p_workspace_id, 'rental_collection', followup_row.rental_collection_id, 'followup_' || action_name,
    jsonb_build_object('followupId', followup_row.id, 'action', action_name));
  return jsonb_build_object('followup', to_jsonb(followup_row));
end;
$$;

revoke all on function public.sprint_005_create_document_bundle(uuid, jsonb) from public, anon;
revoke all on function public.sprint_005_save_extraction_review(uuid, uuid, uuid, jsonb) from public, anon;
revoke all on function public.sprint_005_confirm_tenancy_extraction(uuid, uuid, uuid, jsonb, jsonb) from public, anon;
revoke all on function public.sprint_005_record_collection_transaction(uuid, jsonb) from public, anon;
revoke all on function public.sprint_005_confirm_utility_bill(uuid, jsonb) from public, anon;
revoke all on function public.sprint_005_upsert_utility_account(uuid, jsonb) from public, anon;
revoke all on function public.sprint_005_generate_collection(uuid, jsonb) from public, anon;
revoke all on function public.sprint_005_log_collection_reminder(uuid, jsonb) from public, anon;
revoke all on function public.sprint_005_save_collection_followup(uuid, jsonb) from public, anon;
grant execute on function public.sprint_005_create_document_bundle(uuid, jsonb) to authenticated;
grant execute on function public.sprint_005_save_extraction_review(uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.sprint_005_confirm_tenancy_extraction(uuid, uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.sprint_005_record_collection_transaction(uuid, jsonb) to authenticated;
grant execute on function public.sprint_005_confirm_utility_bill(uuid, jsonb) to authenticated;
grant execute on function public.sprint_005_upsert_utility_account(uuid, jsonb) to authenticated;
grant execute on function public.sprint_005_generate_collection(uuid, jsonb) to authenticated;
grant execute on function public.sprint_005_log_collection_reminder(uuid, jsonb) to authenticated;
grant execute on function public.sprint_005_save_collection_followup(uuid, jsonb) to authenticated;
