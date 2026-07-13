-- Sprint 003 live collection hardening
-- Safe corrective migration for live utility bill uploads, duplicate prevention, and account matching.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'utility-bills',
  'utility-bills',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/jpeg',
    'image/png'
  ]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.documents
  add column if not exists document_hash text;

alter table public.utility_accounts
  add column if not exists account_number_normalized text not null default '';

update public.utility_accounts
set account_number_normalized = upper(regexp_replace(coalesce(account_number, ''), '[^A-Za-z0-9]', '', 'g'))
where account_number_normalized = '';

create unique index if not exists documents_document_hash_unique
on public.documents (document_hash)
where document_hash is not null and document_hash <> '';

create unique index if not exists utility_accounts_provider_account_normalized_unique
on public.utility_accounts (provider, account_number_normalized)
where account_number_normalized <> '';

create index if not exists utility_accounts_provider_tenancy_meter_idx
on public.utility_accounts (provider, tenancy_id, meter_number);

create index if not exists utility_bills_practical_duplicate_idx
on public.utility_bills (provider, bill_number, billing_period_start, billing_period_end, total_amount_due);

drop policy if exists "utility bills storage beta read" on storage.objects;
create policy "utility bills storage beta read"
on storage.objects for select to anon, authenticated
using (bucket_id in ('utility-bills', 'real-estate-documents'));

drop policy if exists "utility bills storage beta insert" on storage.objects;
create policy "utility bills storage beta insert"
on storage.objects for insert to anon, authenticated
with check (bucket_id in ('utility-bills', 'real-estate-documents'));

drop policy if exists "utility bills storage beta update" on storage.objects;
create policy "utility bills storage beta update"
on storage.objects for update to anon, authenticated
using (bucket_id in ('utility-bills', 'real-estate-documents'))
with check (bucket_id in ('utility-bills', 'real-estate-documents'));

drop policy if exists "utility bills storage beta delete" on storage.objects;
create policy "utility bills storage beta delete"
on storage.objects for delete to anon, authenticated
using (bucket_id in ('utility-bills', 'real-estate-documents'));
