create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.tenancies (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  tenant_id_no text not null default '',
  tenant_phone text not null default '',
  tenant_email text not null default '',
  landlord text not null,
  landlord_id_no text not null default '',
  landlord_phone text not null default '',
  landlord_email text not null default '',
  property text not null,
  unit_no text not null default '',
  property_address text not null default '',
  property_type text not null default '',
  monthly_rental numeric(12, 2) not null default 0,
  security_deposit numeric(12, 2) not null default 0,
  utility_deposit numeric(12, 2) not null default 0,
  access_card_deposit numeric(12, 2) not null default 0,
  car_park_remote_deposit numeric(12, 2) not null default 0,
  commencement_date date not null,
  expiry_date date not null,
  renewal_option text not null default '',
  notice_period text not null default '',
  renewal_reminder date,
  signed_ta text not null default '',
  renewal_history text not null default '',
  special_clauses text not null default '',
  notes text not null default '',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenancies
  add column if not exists tenant_id_no text not null default '',
  add column if not exists tenant_phone text not null default '',
  add column if not exists tenant_email text not null default '',
  add column if not exists landlord_id_no text not null default '',
  add column if not exists landlord_phone text not null default '',
  add column if not exists landlord_email text not null default '',
  add column if not exists unit_no text not null default '',
  add column if not exists property_address text not null default '',
  add column if not exists property_type text not null default '',
  add column if not exists security_deposit numeric(12, 2) not null default 0,
  add column if not exists car_park_remote_deposit numeric(12, 2) not null default 0,
  add column if not exists renewal_option text not null default '',
  add column if not exists notice_period text not null default '',
  add column if not exists status text not null default 'active';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tenancies' and column_name = 'deposit'
  ) then
    update public.tenancies
    set security_deposit = coalesce(nullif(security_deposit, 0), deposit)
    where security_deposit = 0 and deposit is not null;
  end if;
end $$;

create table if not exists public.rental_collections (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.tenancies (id) on delete cascade,
  collection_month date not null,
  due_date date not null,
  rental_amount numeric(12, 2) not null default 0,
  tnb_amount numeric(12, 2) not null default 0,
  water_amount numeric(12, 2) not null default 0,
  iwk_amount numeric(12, 2) not null default 0,
  wifi_amount numeric(12, 2) not null default 0,
  aircond_amount numeric(12, 2) not null default 0,
  other_charges numeric(12, 2) not null default 0,
  total_due numeric(12, 2) generated always as (
    rental_amount + tnb_amount + water_amount + iwk_amount + wifi_amount + aircond_amount + other_charges
  ) stored,
  amount_paid numeric(12, 2) not null default 0,
  outstanding_balance numeric(12, 2) generated always as (
    greatest((rental_amount + tnb_amount + water_amount + iwk_amount + wifi_amount + aircond_amount + other_charges) - amount_paid, 0)
  ) stored,
  payment_status text not null default 'outstanding',
  payment_date date,
  payment_method text not null default '',
  payment_reference text not null default '',
  notes text not null default '',
  payment_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.rental_collections
  add column if not exists rental_amount numeric(12, 2) not null default 0,
  add column if not exists tnb_amount numeric(12, 2) not null default 0,
  add column if not exists water_amount numeric(12, 2) not null default 0,
  add column if not exists iwk_amount numeric(12, 2) not null default 0,
  add column if not exists wifi_amount numeric(12, 2) not null default 0,
  add column if not exists aircond_amount numeric(12, 2) not null default 0,
  add column if not exists other_charges numeric(12, 2) not null default 0,
  add column if not exists payment_status text not null default 'outstanding',
  add column if not exists payment_date date,
  add column if not exists payment_method text not null default '',
  add column if not exists payment_reference text not null default '',
  add column if not exists payment_history jsonb not null default '[]'::jsonb;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rental_collections' and column_name = 'amount_due'
  ) then
    update public.rental_collections
    set rental_amount = coalesce(nullif(rental_amount, 0), amount_due)
    where rental_amount = 0 and amount_due is not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rental_collections' and column_name = 'status'
  ) then
    update public.rental_collections
    set payment_status = case status when 'late' then 'overdue' else status end
    where payment_status = 'outstanding' and status is not null;
  end if;
end $$;

create table if not exists public.tenancy_documents (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid references public.tenancies (id) on delete set null,
  original_filename text not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null default 0,
  document_type text not null default 'tenancy_agreement',
  upload_status text not null default 'uploaded',
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenancy_extractions (
  id uuid primary key default gen_random_uuid(),
  tenancy_document_id uuid not null references public.tenancy_documents (id) on delete cascade,
  extraction_status text not null default 'ready',
  extracted_json jsonb not null default '{}'::jsonb,
  raw_text text not null default '',
  ai_summary text not null default '',
  confidence_json jsonb not null default '{}'::jsonb,
  extraction_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenancies_required_text' and conrelid = 'public.tenancies'::regclass) then
    alter table public.tenancies add constraint tenancies_required_text check (length(btrim(tenant)) > 0 and length(btrim(landlord)) > 0 and length(btrim(property)) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenancies_money_non_negative' and conrelid = 'public.tenancies'::regclass) then
    alter table public.tenancies add constraint tenancies_money_non_negative check (monthly_rental >= 0 and security_deposit >= 0 and utility_deposit >= 0 and access_card_deposit >= 0 and car_park_remote_deposit >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenancies_valid_dates' and conrelid = 'public.tenancies'::regclass) then
    alter table public.tenancies add constraint tenancies_valid_dates check (expiry_date > commencement_date and (renewal_reminder is null or (renewal_reminder >= commencement_date and renewal_reminder < expiry_date)));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenancies_status_valid' and conrelid = 'public.tenancies'::regclass) then
    alter table public.tenancies add constraint tenancies_status_valid check (status in ('active', 'expired', 'terminated', 'draft'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenancies_unique_tenant_property_unit' and conrelid = 'public.tenancies'::regclass) then
    alter table public.tenancies add constraint tenancies_unique_tenant_property_unit unique (tenant, property, unit_no);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rental_collections_amounts_valid' and conrelid = 'public.rental_collections'::regclass) then
    alter table public.rental_collections add constraint rental_collections_amounts_valid check (rental_amount >= 0 and tnb_amount >= 0 and water_amount >= 0 and iwk_amount >= 0 and wifi_amount >= 0 and aircond_amount >= 0 and other_charges >= 0 and amount_paid >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rental_collections_payment_status_valid' and conrelid = 'public.rental_collections'::regclass) then
    alter table public.rental_collections add constraint rental_collections_payment_status_valid check (payment_status in ('paid', 'partial', 'outstanding', 'overdue'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rental_collections_month_first_day' and conrelid = 'public.rental_collections'::regclass) then
    alter table public.rental_collections add constraint rental_collections_month_first_day check (collection_month = date_trunc('month', collection_month)::date);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rental_collections_unique_tenancy_month' and conrelid = 'public.rental_collections'::regclass) then
    alter table public.rental_collections add constraint rental_collections_unique_tenancy_month unique (tenancy_id, collection_month);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenancy_documents_file_size_valid' and conrelid = 'public.tenancy_documents'::regclass) then
    alter table public.tenancy_documents add constraint tenancy_documents_file_size_valid check (file_size >= 0 and file_size <= 10485760);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenancy_documents_mime_type_valid' and conrelid = 'public.tenancy_documents'::regclass) then
    alter table public.tenancy_documents add constraint tenancy_documents_mime_type_valid check (mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
  end if;
end $$;

create index if not exists tenancies_tenant_idx on public.tenancies (tenant);
create index if not exists tenancies_landlord_idx on public.tenancies (landlord);
create index if not exists tenancies_property_idx on public.tenancies (property);
create index if not exists tenancies_unit_no_idx on public.tenancies (unit_no);
create index if not exists tenancies_renewal_reminder_idx on public.tenancies (renewal_reminder);
create index if not exists tenancies_status_idx on public.tenancies (status);
create index if not exists rental_collections_tenancy_idx on public.rental_collections (tenancy_id);
create index if not exists rental_collections_month_idx on public.rental_collections (collection_month);
create index if not exists rental_collections_payment_status_idx on public.rental_collections (payment_status);
create index if not exists rental_collections_due_date_idx on public.rental_collections (due_date);
create index if not exists tenancy_documents_tenancy_idx on public.tenancy_documents (tenancy_id);
create index if not exists tenancy_documents_storage_path_idx on public.tenancy_documents (storage_path);
create index if not exists tenancy_extractions_document_idx on public.tenancy_extractions (tenancy_document_id);
create index if not exists tenancy_extractions_status_idx on public.tenancy_extractions (extraction_status);

drop trigger if exists set_tenancies_updated_at on public.tenancies;
create trigger set_tenancies_updated_at before update on public.tenancies for each row execute function public.set_updated_at();
drop trigger if exists set_rental_collections_updated_at on public.rental_collections;
create trigger set_rental_collections_updated_at before update on public.rental_collections for each row execute function public.set_updated_at();
drop trigger if exists set_tenancy_documents_updated_at on public.tenancy_documents;
create trigger set_tenancy_documents_updated_at before update on public.tenancy_documents for each row execute function public.set_updated_at();
drop trigger if exists set_tenancy_extractions_updated_at on public.tenancy_extractions;
create trigger set_tenancy_extractions_updated_at before update on public.tenancy_extractions for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenancy-documents',
  'tenancy-documents',
  false,
  10485760,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.tenancies enable row level security;
alter table public.rental_collections enable row level security;
alter table public.tenancy_documents enable row level security;
alter table public.tenancy_extractions enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.tenancies to anon, authenticated;
grant select, insert, update, delete on public.rental_collections to anon, authenticated;
grant select, insert, update, delete on public.tenancy_documents to anon, authenticated;
grant select, insert, update, delete on public.tenancy_extractions to anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['tenancies', 'rental_collections', 'tenancy_documents', 'tenancy_extractions']
  loop
    execute format('drop policy if exists "Founders beta read %1$s" on public.%1$I', table_name);
    execute format('create policy "Founders beta read %1$s" on public.%1$I for select to anon, authenticated using (true)', table_name);
    execute format('drop policy if exists "Founders beta insert %1$s" on public.%1$I', table_name);
    execute format('create policy "Founders beta insert %1$s" on public.%1$I for insert to anon, authenticated with check (true)', table_name);
    execute format('drop policy if exists "Founders beta update %1$s" on public.%1$I', table_name);
    execute format('create policy "Founders beta update %1$s" on public.%1$I for update to anon, authenticated using (true) with check (true)', table_name);
    execute format('drop policy if exists "Founders beta delete %1$s" on public.%1$I', table_name);
    execute format('create policy "Founders beta delete %1$s" on public.%1$I for delete to anon, authenticated using (true)', table_name);
  end loop;
end $$;

drop policy if exists "Founders beta upload tenancy documents" on storage.objects;
create policy "Founders beta upload tenancy documents"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'tenancy-documents');

drop policy if exists "Founders beta read tenancy documents" on storage.objects;
create policy "Founders beta read tenancy documents"
on storage.objects for select to anon, authenticated
using (bucket_id = 'tenancy-documents');

drop policy if exists "Founders beta update tenancy documents" on storage.objects;
create policy "Founders beta update tenancy documents"
on storage.objects for update to anon, authenticated
using (bucket_id = 'tenancy-documents')
with check (bucket_id = 'tenancy-documents');
