-- NON-EXECUTED REVIEW DRAFT.
-- Phase B: install/normalize the canonical Contacts prerequisite only.
-- Commercial, Legal, Rental, Documents, and AI extraction are not changed.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Refuse an unexpected partial Contacts state.
do $guard$
declare
  present_count integer;
begin
  if to_regclass('public.workspaces') is null
     or to_regclass('public.workspace_members') is null
     or to_regprocedure('public.has_workspace_role(uuid,text[])') is null then
    raise exception 'NORMALIZATION BLOCKED: workspace/RBAC prerequisites are missing';
  end if;

  select count(*) into present_count
  from unnest(array[
    'contacts','contact_roles','tenancy_contacts','contact_channels',
    'contact_follow_ups','contact_communications',
    'collection_contact_preferences','duplicate_decisions',
    'contact_audit_history'
  ]) name
  where to_regclass(format('public.%I', name)) is not null;

  if present_count not in (0, 9) then
    raise exception 'NORMALIZATION BLOCKED: partial Contacts schema (% of 9 tables)', present_count;
  end if;

  if exists (select 1 from public.tenancies where workspace_id is null) then
    raise exception 'NORMALIZATION BLOCKED: tenancy rows without workspace_id';
  end if;
end
$guard$;

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_type text not null default 'person'
    check (contact_type in ('person','company')),
  client_type text not null default 'prospect'
    check (client_type in (
      'prospect','tenant','buyer','investor','landlord','owner',
      'commercial_tenant','commercial_buyer','company','other'
    )),
  full_name text not null default '',
  company_name text not null default '',
  identification_number text not null default '',
  registration_number text not null default '',
  ren_number text not null default '',
  nationality text not null default '',
  phone_original text not null default '',
  phone_normalized text not null default '',
  phone_country_code text not null default '',
  whatsapp_number text not null default '',
  email text not null default '',
  address text not null default '',
  preferred_language text not null default 'en'
    check (preferred_language in ('en','zh','bilingual')),
  source text not null default '',
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  last_contact_at timestamptz,
  manual_correction boolean not null default false,
  raw_extracted_data jsonb not null default '{}'::jsonb,
  notes text not null default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_workspace_id_unique unique (workspace_id, id)
);

-- Existing all-table installations may predate Sprint 007 columns.
alter table public.contacts
  add column if not exists client_type text not null default 'prospect',
  add column if not exists nationality text not null default '',
  add column if not exists source text not null default '',
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid(),
  add column if not exists last_contact_at timestamptz,
  add column if not exists archived_at timestamptz;

do $contact_constraints$
begin
  if exists (
    select 1
    from public.contacts
    where client_type not in (
      'prospect','tenant','buyer','investor','landlord','owner',
      'commercial_tenant','commercial_buyer','company','other'
    )
  ) then
    raise exception 'NORMALIZATION BLOCKED: contacts.client_type contains unsupported values';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contacts'::regclass
      and conname = 'contacts_client_type_check'
  ) then
    alter table public.contacts
      add constraint contacts_client_type_check
      check (client_type in (
        'prospect','tenant','buyer','investor','landlord','owner',
        'commercial_tenant','commercial_buyer','company','other'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contacts'::regclass
      and conname = 'contacts_workspace_id_unique'
  ) then
    alter table public.contacts
      add constraint contacts_workspace_id_unique unique (workspace_id, id);
  end if;
end
$contact_constraints$;

create table if not exists public.contact_roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null,
  role text not null,
  represents text not null default 'unknown'
    check (represents in ('tenant','landlord','both','neutral','unknown')),
  source_page integer,
  source_excerpt text not null default '',
  confidence numeric(5,2) not null default 0 check (confidence between 0 and 100),
  is_primary_contact boolean not null default false,
  follow_up_enabled boolean not null default true,
  collection_authorized boolean not null default false,
  manual_correction boolean not null default false,
  raw_extracted_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_roles_workspace_id_unique unique (workspace_id, id),
  constraint contact_roles_contact_workspace_fk
    foreign key (workspace_id, contact_id)
    references public.contacts(workspace_id, id) on delete cascade
);

-- The existing tenancy primary key is globally unique; this companion key
-- permits workspace-safe composite references without changing row identity.
do $tenancy_parent_key$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenancies'::regclass
      and conname = 'tenancies_workspace_id_id_unique'
  ) then
    alter table public.tenancies
      add constraint tenancies_workspace_id_id_unique unique (workspace_id, id);
  end if;
end
$tenancy_parent_key$;

do $document_parent_key$
begin
  if exists (select 1 from public.documents where workspace_id is null) then
    raise exception 'NORMALIZATION BLOCKED: document rows without workspace_id';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.documents'::regclass
      and conname = 'documents_workspace_id_id_unique'
  ) then
    alter table public.documents
      add constraint documents_workspace_id_id_unique unique (workspace_id, id);
  end if;
end
$document_parent_key$;

create table if not exists public.tenancy_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tenancy_id uuid not null,
  contact_id uuid not null,
  contact_role_id uuid,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint tenancy_contacts_tenancy_workspace_fk
    foreign key (workspace_id, tenancy_id)
    references public.tenancies(workspace_id, id) on delete cascade,
  constraint tenancy_contacts_contact_workspace_fk
    foreign key (workspace_id, contact_id)
    references public.contacts(workspace_id, id) on delete cascade,
  constraint tenancy_contacts_role_workspace_fk
    foreign key (workspace_id, contact_role_id)
    references public.contact_roles(workspace_id, id)
    on delete set null (contact_role_id),
  constraint tenancy_contacts_identity_unique
    unique (workspace_id, tenancy_id, contact_id, contact_role_id)
);

create table if not exists public.contact_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null,
  channel text not null check (channel in ('phone','whatsapp','email')),
  value text not null,
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint contact_channels_contact_workspace_fk
    foreign key (workspace_id, contact_id)
    references public.contacts(workspace_id, id) on delete cascade,
  constraint contact_channels_identity_unique
    unique (workspace_id, contact_id, channel, value)
);

create table if not exists public.contact_follow_ups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null,
  tenancy_id uuid,
  status text not null default 'new' check (status in (
    'no_action_required','new','to_contact','contacted','awaiting_reply',
    'payment_promised','partial_payment','paid','escalation_required','closed'
  )),
  next_follow_up_date date,
  assigned_user_id uuid references auth.users(id) on delete set null,
  last_contact_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_follow_ups_workspace_id_unique unique (workspace_id, id),
  constraint contact_follow_ups_contact_workspace_fk
    foreign key (workspace_id, contact_id)
    references public.contacts(workspace_id, id) on delete cascade,
  constraint contact_follow_ups_tenancy_workspace_fk
    foreign key (workspace_id, tenancy_id)
    references public.tenancies(workspace_id, id)
    on delete set null (tenancy_id)
);

create table if not exists public.contact_communications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null,
  tenancy_id uuid,
  follow_up_id uuid,
  channel text not null check (channel in ('call','whatsapp','email','note')),
  outcome text not null default '',
  message_template text not null default '',
  template_type text not null default '',
  language text not null default 'en'
    check (language in ('en','zh','bilingual')),
  status text not null default 'prepared' check (status in (
    'prepared','sent_manually','no_answer','replied','payment_promised',
    'follow_up_required','wrong_number'
  )),
  follow_up_date date,
  note text not null default '',
  content_hash text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint contact_communications_contact_workspace_fk
    foreign key (workspace_id, contact_id)
    references public.contacts(workspace_id, id) on delete cascade,
  constraint contact_communications_tenancy_workspace_fk
    foreign key (workspace_id, tenancy_id)
    references public.tenancies(workspace_id, id)
    on delete set null (tenancy_id),
  constraint contact_communications_followup_workspace_fk
    foreign key (workspace_id, follow_up_id)
    references public.contact_follow_ups(workspace_id, id)
    on delete set null (follow_up_id)
);

create table if not exists public.collection_contact_preferences (
  tenancy_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  primary_contact_id uuid,
  secondary_contact_id uuid,
  escalation_contact_id uuid,
  preferred_channel text not null default 'whatsapp'
    check (preferred_channel in ('phone','whatsapp','email')),
  preferred_language text not null default 'en'
    check (preferred_language in ('en','zh','bilingual')),
  contact_hours text not null default '',
  consent_notes text not null default '',
  updated_at timestamptz not null default now(),
  constraint collection_contact_preferences_tenancy_workspace_fk
    foreign key (workspace_id, tenancy_id)
    references public.tenancies(workspace_id, id) on delete cascade,
  constraint collection_contact_preferences_primary_workspace_fk
    foreign key (workspace_id, primary_contact_id)
    references public.contacts(workspace_id, id)
    on delete set null (primary_contact_id),
  constraint collection_contact_preferences_secondary_workspace_fk
    foreign key (workspace_id, secondary_contact_id)
    references public.contacts(workspace_id, id)
    on delete set null (secondary_contact_id),
  constraint collection_contact_preferences_escalation_workspace_fk
    foreign key (workspace_id, escalation_contact_id)
    references public.contacts(workspace_id, id)
    on delete set null (escalation_contact_id)
);

create table if not exists public.duplicate_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid,
  tenancy_id uuid,
  matched_document_id uuid,
  matched_tenancy_id uuid,
  similarity_score numeric(5,2) not null default 0
    check (similarity_score between 0 and 100),
  decision text not null
    check (decision in ('reused','retried','overridden','blocked')),
  rationale text not null default '',
  decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint duplicate_decisions_document_workspace_fk
    foreign key (workspace_id, document_id)
    references public.documents(workspace_id, id)
    on delete set null (document_id),
  constraint duplicate_decisions_tenancy_workspace_fk
    foreign key (workspace_id, tenancy_id)
    references public.tenancies(workspace_id, id)
    on delete set null (tenancy_id),
  constraint duplicate_decisions_matched_document_workspace_fk
    foreign key (workspace_id, matched_document_id)
    references public.documents(workspace_id, id)
    on delete set null (matched_document_id),
  constraint duplicate_decisions_matched_tenancy_workspace_fk
    foreign key (workspace_id, matched_tenancy_id)
    references public.tenancies(workspace_id, id)
    on delete set null (matched_tenancy_id)
);

create table if not exists public.contact_audit_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null,
  action text not null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint contact_audit_history_contact_workspace_fk
    foreign key (workspace_id, contact_id)
    references public.contacts(workspace_id, id) on delete cascade
);

create index if not exists contacts_workspace_name_idx
  on public.contacts(workspace_id, full_name);
create unique index if not exists contacts_workspace_phone_unique
  on public.contacts(workspace_id, phone_normalized)
  where phone_normalized <> '';
create unique index if not exists contacts_workspace_email_unique
  on public.contacts(workspace_id, lower(email))
  where email <> '';
create index if not exists contacts_workspace_assignee_active_idx
  on public.contacts(workspace_id, assigned_user_id, updated_at desc)
  where archived_at is null;
create index if not exists contact_roles_workspace_contact_idx
  on public.contact_roles(workspace_id, contact_id);
create index if not exists tenancy_contacts_workspace_tenancy_idx
  on public.tenancy_contacts(workspace_id, tenancy_id);
create index if not exists contact_follow_ups_workspace_status_date_idx
  on public.contact_follow_ups(workspace_id, status, next_follow_up_date);
create index if not exists contact_communications_workspace_contact_idx
  on public.contact_communications(workspace_id, contact_id, created_at desc);
create index if not exists contact_communications_workspace_followup_idx
  on public.contact_communications(workspace_id, follow_up_date)
  where follow_up_date is not null;
create index if not exists duplicate_decisions_workspace_document_idx
  on public.duplicate_decisions(workspace_id, document_id, created_at desc);

do $policies$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'contacts','contact_roles','tenancy_contacts','contact_channels',
    'contact_follow_ups','contact_communications',
    'collection_contact_preferences','duplicate_decisions',
    'contact_audit_history'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);

    if exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and policyname not in (
          table_name || ' workspace select',
          table_name || ' workspace insert',
          table_name || ' workspace update',
          table_name || ' workspace delete',
          table_name || ' workspace write'
        )
    ) then
      raise exception 'NORMALIZATION BLOCKED: unreviewed policy exists on %', table_name;
    end if;

    foreach policy_name in array array[
      table_name || ' workspace select',
      table_name || ' workspace insert',
      table_name || ' workspace update',
      table_name || ' workspace delete',
      table_name || ' workspace write'
    ] loop
      execute format('drop policy if exists %I on public.%I', policy_name, table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (
        public.has_workspace_role(workspace_id, array[
          ''owner'',''admin'',''manager'',''agent'',''finance'',''viewer''
        ])
      )',
      table_name || ' workspace select', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (
        public.has_workspace_role(workspace_id, array[
          ''owner'',''admin'',''manager'',''agent''
        ])
      )',
      table_name || ' workspace insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (
        public.has_workspace_role(workspace_id, array[
          ''owner'',''admin'',''manager'',''agent''
        ])
      ) with check (
        public.has_workspace_role(workspace_id, array[
          ''owner'',''admin'',''manager'',''agent''
        ])
      )',
      table_name || ' workspace update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (
        public.has_workspace_role(workspace_id, array[''owner'',''admin''])
      )',
      table_name || ' workspace delete', table_name
    );
  end loop;
end
$policies$;

revoke all on table
  public.contacts,
  public.contact_roles,
  public.tenancy_contacts,
  public.contact_channels,
  public.contact_follow_ups,
  public.contact_communications,
  public.collection_contact_preferences,
  public.duplicate_decisions,
  public.contact_audit_history
from public, anon;

grant select, insert, update, delete on table
  public.contacts,
  public.contact_roles,
  public.tenancy_contacts,
  public.contact_channels,
  public.contact_follow_ups,
  public.contact_communications,
  public.collection_contact_preferences,
  public.duplicate_decisions,
  public.contact_audit_history
to authenticated;

notify pgrst, 'reload schema';
commit;
