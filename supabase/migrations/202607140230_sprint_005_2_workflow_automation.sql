-- Sprint 005.2 AI Tenancy Workflow Automation.
-- Additive workflow state; no existing records or routes are removed.

alter table public.tenancies
  add column if not exists tenant_identity_expiry date,
  add column if not exists insurance_expiry date;

alter table public.rental_collections
  add column if not exists overpayment_credit numeric(12, 2) not null default 0;

alter table public.documents
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists last_processing_error text not null default '',
  add column if not exists processing_started_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.rental_collections'::regclass
      and conname = 'rental_collections_credit_valid'
  ) then
    alter table public.rental_collections
      add constraint rental_collections_credit_valid check (overpayment_credit >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_processing_attempts_valid'
  ) then
    alter table public.documents
      add constraint documents_processing_attempts_valid check (processing_attempts between 0 and 3);
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.collection_payments'::regclass
      and conname = 'collection_payments_transaction_type_check'
  ) then
    alter table public.collection_payments
      drop constraint collection_payments_transaction_type_check;
  end if;

  alter table public.collection_payments
    add constraint collection_payments_transaction_type_check
    check (transaction_type in ('payment', 'advance_payment', 'adjustment', 'waiver', 'refund', 'reversal'));
end;
$$;

create index if not exists tenancies_expiry_warning_idx
  on public.tenancies (workspace_id, expiry_date, tenant_identity_expiry, insurance_expiry);

create index if not exists utility_bills_tenancy_provider_date_idx
  on public.utility_bills (tenancy_id, provider, bill_date desc);

create index if not exists documents_retryable_processing_idx
  on public.documents (workspace_id, processing_status, processing_attempts)
  where processing_status in ('ocr_required', 'extraction_failed');
