-- Workspace-scoped contact intelligence. This migration is additive and keeps
-- the existing tenancy import path intact until clients opt into these tables.
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_type text not null default 'person' check (contact_type in ('person', 'company')),
  full_name text not null default '',
  company_name text not null default '',
  identification_number text not null default '',
  registration_number text not null default '',
  ren_number text not null default '',
  phone_original text not null default '',
  phone_normalized text not null default '',
  phone_country_code text not null default '',
  whatsapp_number text not null default '',
  email text not null default '',
  address text not null default '',
  preferred_language text not null default 'en' check (preferred_language in ('en', 'zh', 'bilingual')),
  manual_correction boolean not null default false,
  raw_extracted_data jsonb not null default '{}'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contact_roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  role text not null,
  represents text not null default 'unknown' check (represents in ('tenant', 'landlord', 'both', 'neutral', 'unknown')),
  source_page integer,
  source_excerpt text not null default '',
  confidence numeric(5,2) not null default 0 check (confidence between 0 and 100),
  is_primary_contact boolean not null default false,
  follow_up_enabled boolean not null default true,
  collection_authorized boolean not null default false,
  manual_correction boolean not null default false,
  raw_extracted_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenancy_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  contact_role_id uuid references public.contact_roles(id) on delete set null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenancy_id, contact_id, contact_role_id)
);

create table if not exists public.contact_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel text not null check (channel in ('phone', 'whatsapp', 'email')),
  value text not null,
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (contact_id, channel, value)
);

create table if not exists public.contact_follow_ups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  status text not null default 'new' check (status in ('no_action_required', 'new', 'to_contact', 'contacted', 'awaiting_reply', 'payment_promised', 'partial_payment', 'paid', 'escalation_required', 'closed')),
  next_follow_up_date date,
  assigned_user_id uuid references auth.users(id) on delete set null,
  last_contact_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contact_communications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  follow_up_id uuid references public.contact_follow_ups(id) on delete set null,
  channel text not null check (channel in ('call', 'whatsapp', 'email', 'note')),
  outcome text not null default '',
  message_template text not null default '',
  content_hash text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.collection_contact_preferences (
  tenancy_id uuid primary key references public.tenancies(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  primary_contact_id uuid references public.contacts(id) on delete set null,
  secondary_contact_id uuid references public.contacts(id) on delete set null,
  escalation_contact_id uuid references public.contacts(id) on delete set null,
  preferred_channel text not null default 'whatsapp' check (preferred_channel in ('phone', 'whatsapp', 'email')),
  preferred_language text not null default 'en' check (preferred_language in ('en', 'zh', 'bilingual')),
  contact_hours text not null default '',
  consent_notes text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.duplicate_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid references public.documents(id) on delete set null,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  matched_document_id uuid references public.documents(id) on delete set null,
  matched_tenancy_id uuid references public.tenancies(id) on delete set null,
  similarity_score numeric(5,2) not null default 0 check (similarity_score between 0 and 100),
  decision text not null check (decision in ('reused', 'retried', 'overridden', 'blocked')),
  rationale text not null default '',
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_audit_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  action text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists contacts_workspace_name_idx on public.contacts(workspace_id, full_name);
create unique index if not exists contacts_workspace_phone_unique on public.contacts(workspace_id, phone_normalized) where phone_normalized <> '';
create unique index if not exists contacts_workspace_email_unique on public.contacts(workspace_id, lower(email)) where email <> '';
create index if not exists contact_roles_workspace_contact_idx on public.contact_roles(workspace_id, contact_id);
create index if not exists tenancy_contacts_workspace_tenancy_idx on public.tenancy_contacts(workspace_id, tenancy_id);
create index if not exists contact_follow_ups_workspace_status_date_idx on public.contact_follow_ups(workspace_id, status, next_follow_up_date);
create index if not exists contact_communications_workspace_contact_idx on public.contact_communications(workspace_id, contact_id, created_at desc);
create index if not exists duplicate_decisions_workspace_document_idx on public.duplicate_decisions(workspace_id, document_id, created_at desc);

alter table public.contacts enable row level security;
alter table public.contact_roles enable row level security;
alter table public.tenancy_contacts enable row level security;
alter table public.contact_channels enable row level security;
alter table public.contact_follow_ups enable row level security;
alter table public.contact_communications enable row level security;
alter table public.collection_contact_preferences enable row level security;
alter table public.duplicate_decisions enable row level security;
alter table public.contact_audit_history enable row level security;

do $$
declare table_name text;
begin
  foreach table_name in array array['contacts','contact_roles','tenancy_contacts','contact_channels','contact_follow_ups','contact_communications','collection_contact_preferences','duplicate_decisions','contact_audit_history'] loop
    execute format('drop policy if exists "%s workspace select" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%s workspace write" on public.%I', table_name, table_name);
    execute format('create policy "%s workspace select" on public.%I for select to authenticated using (public.has_workspace_role(workspace_id, array[''owner'', ''admin'', ''manager'', ''agent'', ''finance'']))', table_name, table_name);
    execute format('create policy "%s workspace write" on public.%I for all to authenticated using (public.has_workspace_role(workspace_id, array[''owner'', ''admin'', ''manager'', ''agent'', ''finance''])) with check (public.has_workspace_role(workspace_id, array[''owner'', ''admin'', ''manager'', ''agent'', ''finance'']))', table_name, table_name);
  end loop;
end $$;

notify pgrst, 'reload schema';
