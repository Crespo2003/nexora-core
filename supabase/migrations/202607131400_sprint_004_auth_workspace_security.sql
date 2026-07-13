-- Sprint 004 Auth, Workspace Security, and Live Hardening
-- Safe after Sprint 001, Sprint 002, and Sprint 003.

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

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  phone text not null default '',
  preferred_language text not null default 'en' check (preferred_language in ('en', 'zh', 'ms')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'manager', 'agent', 'finance', 'viewer')),
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

alter table public.tenancies add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.rental_collections add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.tenancy_documents add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.tenancy_extractions add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.documents add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.document_extractions add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.document_links add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.import_jobs add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.document_activity add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.utility_accounts add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.utility_account_history add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.utility_bills add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.collection_payments add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.collection_reminders add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.collection_followups add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.collection_adjustments add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;
alter table public.activity_logs add column if not exists workspace_id uuid references public.workspaces(id) on delete restrict;

create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists workspaces_owner_idx on public.workspaces (owner_user_id);
create index if not exists workspace_members_user_idx on public.workspace_members (user_id);
create index if not exists workspace_members_workspace_role_idx on public.workspace_members (workspace_id, role, status);

create index if not exists tenancies_workspace_idx on public.tenancies (workspace_id);
create index if not exists rental_collections_workspace_idx on public.rental_collections (workspace_id);
create index if not exists tenancy_documents_workspace_idx on public.tenancy_documents (workspace_id);
create index if not exists tenancy_extractions_workspace_idx on public.tenancy_extractions (workspace_id);
create index if not exists documents_workspace_idx on public.documents (workspace_id);
create index if not exists document_extractions_workspace_idx on public.document_extractions (workspace_id);
create index if not exists document_links_workspace_idx on public.document_links (workspace_id);
create index if not exists import_jobs_workspace_idx on public.import_jobs (workspace_id);
create index if not exists document_activity_workspace_idx on public.document_activity (workspace_id);
create index if not exists utility_accounts_workspace_idx on public.utility_accounts (workspace_id);
create index if not exists utility_account_history_workspace_idx on public.utility_account_history (workspace_id);
create index if not exists utility_bills_workspace_idx on public.utility_bills (workspace_id);
create index if not exists collection_payments_workspace_idx on public.collection_payments (workspace_id);
create index if not exists collection_reminders_workspace_idx on public.collection_reminders (workspace_id);
create index if not exists collection_followups_workspace_idx on public.collection_followups (workspace_id);
create index if not exists collection_adjustments_workspace_idx on public.collection_adjustments (workspace_id);
create index if not exists activity_logs_workspace_idx on public.activity_logs (workspace_id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
drop trigger if exists workspace_members_set_updated_at on public.workspace_members;
create trigger workspace_members_set_updated_at before update on public.workspace_members for each row execute function public.set_updated_at();

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.has_workspace_role(target_workspace_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and status = 'active'
      and role = any(allowed_roles)
  );
$$;

create or replace function public.storage_workspace_id(object_name text)
returns uuid
language plpgsql
immutable
security invoker
as $$
declare
  first_folder text;
begin
  first_folder := split_part(object_name, '/', 1);
  begin
    return first_folder::uuid;
  exception when others then
    return null;
  end;
end;
$$;

revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.has_workspace_role(uuid, text[]) from public;
revoke all on function public.storage_workspace_id(text) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, text[]) to authenticated;
grant execute on function public.storage_workspace_id(text) to anon, authenticated;

create or replace function public.workspace_setup_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.workspaces);
$$;

revoke all on function public.workspace_setup_open() from public;
grant execute on function public.workspace_setup_open() to anon, authenticated;

create or replace function public.assign_beta_rows_to_workspace(target_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_workspace_role(target_workspace_id, array['owner','admin']) then
    raise exception 'permission denied';
  end if;

  update public.tenancies set workspace_id = target_workspace_id where workspace_id is null;
  update public.rental_collections set workspace_id = target_workspace_id where workspace_id is null;
  update public.tenancy_documents set workspace_id = target_workspace_id where workspace_id is null;
  update public.tenancy_extractions set workspace_id = target_workspace_id where workspace_id is null;
  update public.documents set workspace_id = target_workspace_id where workspace_id is null;
  update public.document_extractions set workspace_id = target_workspace_id where workspace_id is null;
  update public.document_links set workspace_id = target_workspace_id where workspace_id is null;
  update public.import_jobs set workspace_id = target_workspace_id where workspace_id is null;
  update public.document_activity set workspace_id = target_workspace_id where workspace_id is null;
  update public.utility_accounts set workspace_id = target_workspace_id where workspace_id is null;
  update public.utility_account_history set workspace_id = target_workspace_id where workspace_id is null;
  update public.utility_bills set workspace_id = target_workspace_id where workspace_id is null;
  update public.collection_payments set workspace_id = target_workspace_id where workspace_id is null;
  update public.collection_reminders set workspace_id = target_workspace_id where workspace_id is null;
  update public.collection_followups set workspace_id = target_workspace_id where workspace_id is null;
  update public.collection_adjustments set workspace_id = target_workspace_id where workspace_id is null;
  update public.activity_logs set workspace_id = target_workspace_id where workspace_id is null;
end;
$$;

revoke all on function public.assign_beta_rows_to_workspace(uuid) from public;
grant execute on function public.assign_beta_rows_to_workspace(uuid) to authenticated;

create or replace function public.bootstrap_first_workspace(
  workspace_name text,
  profile_full_name text,
  profile_phone text default '',
  profile_language text default 'en'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  caller_email text := coalesce(auth.jwt() ->> 'email', '');
  new_workspace_id uuid;
  new_membership_id uuid;
begin
  if caller_id is null then
    raise exception 'authentication required';
  end if;
  if nullif(trim(workspace_name), '') is null or nullif(trim(profile_full_name), '') is null then
    raise exception 'workspace name and full name are required';
  end if;
  if profile_language not in ('en', 'zh', 'ms') then
    raise exception 'unsupported language';
  end if;

  perform pg_advisory_xact_lock(hashtext('nexora:first-workspace'));
  if exists (select 1 from public.workspaces) then
    raise exception 'setup closed';
  end if;

  insert into public.profiles (id, email, full_name, phone, preferred_language)
  values (caller_id, caller_email, trim(profile_full_name), coalesce(profile_phone, ''), profile_language)
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    phone = excluded.phone,
    preferred_language = excluded.preferred_language;

  insert into public.workspaces (name, owner_user_id, status)
  values (trim(workspace_name), caller_id, 'active')
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (new_workspace_id, caller_id, 'owner', 'active')
  returning id into new_membership_id;

  perform public.assign_beta_rows_to_workspace(new_workspace_id);

  return jsonb_build_object(
    'workspaceId', new_workspace_id,
    'profileId', caller_id,
    'membershipId', new_membership_id
  );
end;
$$;

revoke all on function public.bootstrap_first_workspace(text, text, text, text) from public;
grant execute on function public.bootstrap_first_workspace(text, text, text, text) to authenticated;

create or replace function public.sprint_004_system_check(target_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  required_tables text[] := array[
    'profiles','workspaces','workspace_members','tenancies','rental_collections','documents',
    'document_extractions','document_links','import_jobs','utility_accounts','utility_bills',
    'collection_payments','collection_reminders','collection_followups','activity_logs'
  ];
  required_workspace_tables text[] := array[
    'tenancies','rental_collections','documents','document_extractions','document_links','import_jobs',
    'utility_accounts','utility_account_history','utility_bills','collection_payments',
    'collection_reminders','collection_followups','collection_adjustments','activity_logs'
  ];
begin
  if not public.has_workspace_role(target_workspace_id, array['owner','admin']) then
    raise exception 'permission denied';
  end if;

  return jsonb_build_object(
    'tables', (
      select jsonb_object_agg(table_name, exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and information_schema.tables.table_name = table_list.table_name
      ))
      from unnest(required_tables) as table_list(table_name)
    ),
    'workspaceColumns', (
      select jsonb_object_agg(table_name, exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and information_schema.columns.table_name = table_list.table_name and column_name = 'workspace_id'
      ))
      from unnest(required_workspace_tables) as table_list(table_name)
    ),
    'rls', (
      select jsonb_object_agg(c.relname, c.relrowsecurity)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any(required_tables)
    ),
    'buckets', (
      select jsonb_object_agg(id, jsonb_build_object('configured', true, 'public', public))
      from storage.buckets
      where id in ('real-estate-documents', 'tenancy-documents', 'utility-bills')
    ),
    'migration', jsonb_build_object(
      'name', '202607131400_sprint_004_auth_workspace_security',
      'applied', (
        to_regclass('public.profiles') is not null
        and to_regclass('public.workspace_members') is not null
        and exists (select 1 from storage.buckets where id = 'real-estate-documents' and public = false)
      )
    )
  );
end;
$$;

revoke all on function public.sprint_004_system_check(uuid) from public;
grant execute on function public.sprint_004_system_check(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

grant select, insert, update on public.profiles to authenticated;
revoke all on public.workspaces from anon;
grant select on public.workspaces to authenticated;
grant update (name, status) on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;

drop policy if exists "profiles own read" on public.profiles;
drop policy if exists "profiles own insert" on public.profiles;
drop policy if exists "profiles own update" on public.profiles;
create policy "profiles own read" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "profiles own insert" on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy "profiles own update" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "workspaces member read" on public.workspaces;
drop policy if exists "workspaces first owner insert" on public.workspaces;
drop policy if exists "workspaces admin update" on public.workspaces;
create policy "workspaces member read" on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy "workspaces admin update" on public.workspaces for update to authenticated
using (public.has_workspace_role(id, array['owner','admin'])) with check (public.has_workspace_role(id, array['owner','admin']));

drop policy if exists "workspace members read" on public.workspace_members;
drop policy if exists "workspace members first owner insert" on public.workspace_members;
drop policy if exists "workspace members admin write" on public.workspace_members;
drop policy if exists "workspace members admin insert" on public.workspace_members;
drop policy if exists "workspace members admin update" on public.workspace_members;
drop policy if exists "workspace members admin delete" on public.workspace_members;
create policy "workspace members read" on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "workspace members admin insert" on public.workspace_members for insert to authenticated with check (
  public.has_workspace_role(workspace_id, array['owner'])
  or (role <> 'owner' and public.has_workspace_role(workspace_id, array['admin']))
);
create policy "workspace members admin update" on public.workspace_members for update to authenticated
using (
  public.has_workspace_role(workspace_id, array['owner'])
  or (role <> 'owner' and public.has_workspace_role(workspace_id, array['admin']))
)
with check (
  public.has_workspace_role(workspace_id, array['owner'])
  or (role <> 'owner' and public.has_workspace_role(workspace_id, array['admin']))
);
create policy "workspace members admin delete" on public.workspace_members for delete to authenticated using (
  public.has_workspace_role(workspace_id, array['owner'])
  or (role <> 'owner' and public.has_workspace_role(workspace_id, array['admin']))
);

do $$
declare
  table_name text;
  insert_roles text[];
  update_roles text[];
begin
  foreach table_name in array array[
    'tenancies',
    'rental_collections',
    'tenancy_documents',
    'tenancy_extractions',
    'documents',
    'document_extractions',
    'document_links',
    'import_jobs',
    'document_activity',
    'utility_accounts',
    'utility_account_history',
    'utility_bills',
    'collection_payments',
    'collection_reminders',
    'collection_followups',
    'collection_adjustments',
    'activity_logs'
  ]
  loop
    insert_roles := case
      when table_name in ('tenancies','tenancy_documents','tenancy_extractions','documents','document_extractions','document_links','import_jobs','document_activity','utility_accounts','utility_account_history','collection_followups')
        then array['owner','admin','manager','agent']
      when table_name in ('rental_collections','collection_payments','collection_adjustments')
        then array['owner','admin','manager','finance']
      when table_name in ('utility_bills','collection_reminders','activity_logs')
        then array['owner','admin','manager','agent','finance']
      else array['owner','admin']
    end;
    update_roles := case
      when table_name = 'activity_logs' then array[]::text[]
      else insert_roles
    end;

    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('revoke all on public.%I from anon', table_name);

    execute format('drop policy if exists "Founders beta read %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "Founders beta insert %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "Founders beta update %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "Founders beta delete %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "%2$s beta read" on public.%1$I', table_name, replace(table_name, '_', ' '));
    execute format('drop policy if exists "%2$s beta insert" on public.%1$I', table_name, replace(table_name, '_', ' '));
    execute format('drop policy if exists "%2$s beta update" on public.%1$I', table_name, replace(table_name, '_', ' '));
    execute format('drop policy if exists "%2$s beta delete" on public.%1$I', table_name, replace(table_name, '_', ' '));
    execute format('drop policy if exists "%1$s workspace read" on public.%1$I', table_name);
    execute format('drop policy if exists "%1$s workspace insert" on public.%1$I', table_name);
    execute format('drop policy if exists "%1$s workspace update" on public.%1$I', table_name);
    execute format('drop policy if exists "%1$s workspace delete" on public.%1$I', table_name);

    execute format('create policy "%1$s workspace read" on public.%1$I for select to authenticated using (public.is_workspace_member(workspace_id))', table_name);
    execute format('create policy "%1$s workspace insert" on public.%1$I for insert to authenticated with check (public.has_workspace_role(workspace_id, %2$L::text[]))', table_name, insert_roles);
    if cardinality(update_roles) > 0 then
      execute format('create policy "%1$s workspace update" on public.%1$I for update to authenticated using (public.has_workspace_role(workspace_id, %2$L::text[])) with check (public.has_workspace_role(workspace_id, %2$L::text[]))', table_name, update_roles);
    end if;
    execute format('create policy "%1$s workspace delete" on public.%1$I for delete to authenticated using (public.has_workspace_role(workspace_id, array[''owner'',''admin'']))', table_name);
  end loop;
end $$;

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
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "real estate documents beta read" on storage.objects;
drop policy if exists "real estate documents beta insert" on storage.objects;
drop policy if exists "real estate documents beta update" on storage.objects;
drop policy if exists "real estate documents beta delete" on storage.objects;
drop policy if exists "utility bills storage beta read" on storage.objects;
drop policy if exists "utility bills storage beta insert" on storage.objects;
drop policy if exists "utility bills storage beta update" on storage.objects;
drop policy if exists "utility bills storage beta delete" on storage.objects;
drop policy if exists "Founders beta upload tenancy documents" on storage.objects;
drop policy if exists "Founders beta read tenancy documents" on storage.objects;
drop policy if exists "Founders beta update tenancy documents" on storage.objects;

create policy "workspace document storage read"
on storage.objects for select to authenticated
using (bucket_id = 'real-estate-documents' and public.is_workspace_member(public.storage_workspace_id(name)));

create policy "workspace document storage insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'real-estate-documents'
  and (
    public.has_workspace_role(public.storage_workspace_id(name), array['owner','admin','manager'])
    or public.has_workspace_role(public.storage_workspace_id(name), array['agent'])
    or (
      split_part(name, '/', 2) = 'utility-bills'
      and public.has_workspace_role(public.storage_workspace_id(name), array['finance'])
    )
  )
);

create policy "workspace document storage update"
on storage.objects for update to authenticated
using (
  bucket_id = 'real-estate-documents'
  and (
    public.has_workspace_role(public.storage_workspace_id(name), array['owner','admin','manager'])
    or public.has_workspace_role(public.storage_workspace_id(name), array['agent'])
    or (
      split_part(name, '/', 2) = 'utility-bills'
      and public.has_workspace_role(public.storage_workspace_id(name), array['finance'])
    )
  )
)
with check (
  bucket_id = 'real-estate-documents'
  and (
    public.has_workspace_role(public.storage_workspace_id(name), array['owner','admin','manager'])
    or public.has_workspace_role(public.storage_workspace_id(name), array['agent'])
    or (
      split_part(name, '/', 2) = 'utility-bills'
      and public.has_workspace_role(public.storage_workspace_id(name), array['finance'])
    )
  )
);

create policy "workspace document storage delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'real-estate-documents'
  and public.has_workspace_role(public.storage_workspace_id(name), array['owner','admin'])
);
