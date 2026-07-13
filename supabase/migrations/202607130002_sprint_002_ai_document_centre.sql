-- Sprint 002 AI Document Centre
-- Idempotent document intake, extraction, import workflow, storage, RLS, and activity foundation.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'real-estate-documents',
  'real-estate-documents',
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

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  owner_user_id uuid,
  original_filename text not null,
  sanitized_filename text not null,
  storage_bucket text not null default 'real-estate-documents',
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null check (file_size >= 0),
  document_type text not null default 'other' check (
    document_type in (
      'tenancy_agreement',
      'tenancy_renewal',
      'letter_of_offer',
      'booking_form',
      'sale_purchase_agreement',
      'identity_document',
      'company_document',
      'utility_bill',
      'inventory_list',
      'other'
    )
  ),
  upload_status text not null default 'uploaded',
  processing_status text not null default 'uploaded' check (
    processing_status in (
      'uploaded',
      'pending_review',
      'extracting',
      'extraction_completed',
      'extraction_failed',
      'ocr_required',
      'imported',
      'draft'
    )
  ),
  linked_status text not null default 'unlinked' check (linked_status in ('linked', 'unlinked')),
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.documents
  add column if not exists workspace_id uuid,
  add column if not exists owner_user_id uuid,
  add column if not exists original_filename text,
  add column if not exists sanitized_filename text,
  add column if not exists storage_bucket text default 'real-estate-documents',
  add column if not exists storage_path text,
  add column if not exists mime_type text,
  add column if not exists file_size bigint default 0,
  add column if not exists document_type text default 'other',
  add column if not exists upload_status text default 'uploaded',
  add column if not exists processing_status text default 'uploaded',
  add column if not exists linked_status text default 'unlinked',
  add column if not exists uploaded_at timestamptz default now(),
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  extraction_version text not null default 'fallback-v1',
  raw_text text not null default '',
  extracted_json jsonb not null default '{}'::jsonb,
  confidence_json jsonb not null default '{}'::jsonb,
  ai_summary text not null default '',
  extraction_status text not null default 'uploaded',
  extraction_error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.document_extractions
  add column if not exists document_id uuid,
  add column if not exists extraction_version text default 'fallback-v1',
  add column if not exists raw_text text default '',
  add column if not exists extracted_json jsonb default '{}'::jsonb,
  add column if not exists confidence_json jsonb default '{}'::jsonb,
  add column if not exists ai_summary text default '',
  add column if not exists extraction_status text default 'uploaded',
  add column if not exists extraction_error text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create table if not exists public.document_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  entity_type text not null check (entity_type in ('tenancy', 'rental_collection', 'property', 'contact', 'other')),
  entity_id uuid not null,
  link_type text not null default 'source_document',
  created_at timestamptz not null default now(),
  unique (document_id, entity_type, entity_id, link_type)
);

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  import_type text not null default 'tenancy_agreement',
  import_status text not null default 'draft' check (import_status in ('draft', 'saving', 'completed', 'failed', 'cancelled')),
  reviewed_json jsonb not null default '{}'::jsonb,
  created_record_ids jsonb not null default '{}'::jsonb,
  failed_stage text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_activity (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id) on delete cascade,
  activity_type text not null,
  activity_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists documents_type_idx on public.documents (document_type);
create index if not exists documents_processing_status_idx on public.documents (processing_status);
create index if not exists documents_linked_status_idx on public.documents (linked_status);
create index if not exists documents_uploaded_at_idx on public.documents (uploaded_at desc);
create index if not exists documents_original_filename_idx on public.documents using gin (to_tsvector('simple', coalesce(original_filename, '')));
create index if not exists document_extractions_document_id_idx on public.document_extractions (document_id);
create index if not exists document_extractions_status_idx on public.document_extractions (extraction_status);
create index if not exists document_links_document_id_idx on public.document_links (document_id);
create index if not exists document_links_entity_idx on public.document_links (entity_type, entity_id);
create index if not exists import_jobs_document_id_idx on public.import_jobs (document_id);
create index if not exists import_jobs_status_idx on public.import_jobs (import_status);
create index if not exists document_activity_document_id_idx on public.document_activity (document_id);
create index if not exists document_activity_created_at_idx on public.document_activity (created_at desc);

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
before update on public.documents
for each row execute function public.set_updated_at();

drop trigger if exists document_extractions_set_updated_at on public.document_extractions;
create trigger document_extractions_set_updated_at
before update on public.document_extractions
for each row execute function public.set_updated_at();

drop trigger if exists import_jobs_set_updated_at on public.import_jobs;
create trigger import_jobs_set_updated_at
before update on public.import_jobs
for each row execute function public.set_updated_at();

alter table public.documents enable row level security;
alter table public.document_extractions enable row level security;
alter table public.document_links enable row level security;
alter table public.import_jobs enable row level security;
alter table public.document_activity enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.documents to anon, authenticated;
grant select, insert, update, delete on public.document_extractions to anon, authenticated;
grant select, insert, update, delete on public.document_links to anon, authenticated;
grant select, insert, update, delete on public.import_jobs to anon, authenticated;
grant select, insert, update, delete on public.document_activity to anon, authenticated;

drop policy if exists "documents beta read" on public.documents;
drop policy if exists "documents beta insert" on public.documents;
drop policy if exists "documents beta update" on public.documents;
drop policy if exists "documents beta delete" on public.documents;
create policy "documents beta read" on public.documents for select to anon, authenticated using (true);
create policy "documents beta insert" on public.documents for insert to anon, authenticated with check (true);
create policy "documents beta update" on public.documents for update to anon, authenticated using (true) with check (true);
create policy "documents beta delete" on public.documents for delete to anon, authenticated using (true);

drop policy if exists "document extractions beta read" on public.document_extractions;
drop policy if exists "document extractions beta insert" on public.document_extractions;
drop policy if exists "document extractions beta update" on public.document_extractions;
drop policy if exists "document extractions beta delete" on public.document_extractions;
create policy "document extractions beta read" on public.document_extractions for select to anon, authenticated using (true);
create policy "document extractions beta insert" on public.document_extractions for insert to anon, authenticated with check (true);
create policy "document extractions beta update" on public.document_extractions for update to anon, authenticated using (true) with check (true);
create policy "document extractions beta delete" on public.document_extractions for delete to anon, authenticated using (true);

drop policy if exists "document links beta read" on public.document_links;
drop policy if exists "document links beta insert" on public.document_links;
drop policy if exists "document links beta update" on public.document_links;
drop policy if exists "document links beta delete" on public.document_links;
create policy "document links beta read" on public.document_links for select to anon, authenticated using (true);
create policy "document links beta insert" on public.document_links for insert to anon, authenticated with check (true);
create policy "document links beta update" on public.document_links for update to anon, authenticated using (true) with check (true);
create policy "document links beta delete" on public.document_links for delete to anon, authenticated using (true);

drop policy if exists "import jobs beta read" on public.import_jobs;
drop policy if exists "import jobs beta insert" on public.import_jobs;
drop policy if exists "import jobs beta update" on public.import_jobs;
drop policy if exists "import jobs beta delete" on public.import_jobs;
create policy "import jobs beta read" on public.import_jobs for select to anon, authenticated using (true);
create policy "import jobs beta insert" on public.import_jobs for insert to anon, authenticated with check (true);
create policy "import jobs beta update" on public.import_jobs for update to anon, authenticated using (true) with check (true);
create policy "import jobs beta delete" on public.import_jobs for delete to anon, authenticated using (true);

drop policy if exists "document activity beta read" on public.document_activity;
drop policy if exists "document activity beta insert" on public.document_activity;
drop policy if exists "document activity beta update" on public.document_activity;
drop policy if exists "document activity beta delete" on public.document_activity;
create policy "document activity beta read" on public.document_activity for select to anon, authenticated using (true);
create policy "document activity beta insert" on public.document_activity for insert to anon, authenticated with check (true);
create policy "document activity beta update" on public.document_activity for update to anon, authenticated using (true) with check (true);
create policy "document activity beta delete" on public.document_activity for delete to anon, authenticated using (true);

drop policy if exists "real estate documents beta read" on storage.objects;
drop policy if exists "real estate documents beta insert" on storage.objects;
drop policy if exists "real estate documents beta update" on storage.objects;
drop policy if exists "real estate documents beta delete" on storage.objects;
create policy "real estate documents beta read"
on storage.objects for select to anon, authenticated
using (bucket_id = 'real-estate-documents');
create policy "real estate documents beta insert"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'real-estate-documents');
create policy "real estate documents beta update"
on storage.objects for update to anon, authenticated
using (bucket_id = 'real-estate-documents')
with check (bucket_id = 'real-estate-documents');
create policy "real estate documents beta delete"
on storage.objects for delete to anon, authenticated
using (bucket_id = 'real-estate-documents');
