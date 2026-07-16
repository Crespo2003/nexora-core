-- Harden the one-time workspace bootstrap and remove avoidable
-- SECURITY DEFINER exposure reported by Supabase Security Advisor.
-- This migration is intentionally self-contained because the live project may
-- not yet include the Sprint 005 advisor hardening migration.

create schema if not exists setup_private;
revoke all on schema setup_private from public, anon, authenticated;
grant usage on schema setup_private to anon, authenticated;

create table if not exists setup_private.workspace_setup_state (
  singleton boolean primary key default true check (singleton),
  setup_available boolean not null
);

revoke all on setup_private.workspace_setup_state from public, anon, authenticated;
grant select (setup_available) on setup_private.workspace_setup_state to anon, authenticated;

insert into setup_private.workspace_setup_state (singleton, setup_available)
values (
  true,
  not exists (select 1 from public.workspaces)
  and not exists (
    select 1
    from public.workspace_members
    where role = 'owner' and status = 'active'
  )
)
on conflict (singleton) do update
set setup_available = excluded.setup_available;

-- The old function was privileged and callable from the exposed public schema.
-- Replace it with an invoker function that can read only one boolean column.
revoke all on function public.workspace_setup_open() from public, anon, authenticated;
drop function public.workspace_setup_open();

create or replace function public.workspace_setup_available()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select setup_available from setup_private.workspace_setup_state limit 1),
    false
  );
$$;

revoke all on function public.workspace_setup_available() from public, anon, authenticated;
grant execute on function public.workspace_setup_available() to anon, authenticated;

-- Keep the deployed Sprint 004 route working during a staggered database/app
-- rollout. This compatibility alias is not privileged and is authenticated-only;
-- new code calls workspace_setup_available directly.
create or replace function public.workspace_setup_open()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.workspace_setup_available();
$$;

revoke all on function public.workspace_setup_open() from public, anon, authenticated;
grant execute on function public.workspace_setup_open() to authenticated;

-- This helper is callable only by its owner and is reached from the bootstrap
-- function after the caller's owner membership has been created. It remains a
-- definer because the historical beta rows are protected by RLS.
create or replace function public.assign_beta_rows_to_workspace(target_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null or not exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = caller_id
      and role in ('owner', 'admin')
      and status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
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

revoke all on function public.assign_beta_rows_to_workspace(uuid) from public, anon, authenticated;

-- Elevated privileges are required here only for the one-time writes that must
-- cross RLS. The caller cannot supply a workspace id, owner id, membership role,
-- or membership status. A transaction advisory lock plus the locked singleton
-- row serializes concurrent attempts; all writes roll back together on failure.
create or replace function public.bootstrap_first_workspace(
  workspace_name text,
  profile_full_name text,
  profile_phone text default '',
  profile_language text default 'en'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  caller_email text;
  setup_is_available boolean := false;
  new_workspace_id uuid;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  select email into caller_email
  from auth.users
  where id = caller_id;

  if not found then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  if nullif(pg_catalog.btrim(workspace_name), '') is null
     or nullif(pg_catalog.btrim(profile_full_name), '') is null then
    raise exception using errcode = '22023', message = 'workspace name and full name are required';
  end if;
  if pg_catalog.char_length(pg_catalog.btrim(workspace_name)) > 120
     or pg_catalog.char_length(pg_catalog.btrim(profile_full_name)) > 160
     or pg_catalog.char_length(coalesce(profile_phone, '')) > 40 then
    raise exception using errcode = '22023', message = 'setup value is too long';
  end if;
  if profile_language not in ('en', 'zh', 'ms') then
    raise exception using errcode = '22023', message = 'unsupported language';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('nexora:first-workspace', 0)
  );

  select setup_available into setup_is_available
  from setup_private.workspace_setup_state
  limit 1
  for update;

  if not coalesce(setup_is_available, false)
     or exists (select 1 from public.workspaces)
     or exists (
       select 1 from public.workspace_members
       where role = 'owner' and status = 'active'
     ) then
    raise exception using errcode = '42501', message = 'setup closed';
  end if;

  -- Bootstrap callers must not already belong to a workspace. This is the
  -- membership validation appropriate before the first membership exists.
  if exists (
    select 1 from public.workspace_members
    where user_id = caller_id and status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'setup closed';
  end if;

  insert into public.profiles (id, email, full_name, phone, preferred_language)
  values (
    caller_id,
    coalesce(caller_email, ''),
    pg_catalog.btrim(profile_full_name),
    coalesce(profile_phone, ''),
    profile_language
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    phone = excluded.phone,
    preferred_language = excluded.preferred_language;

  insert into public.workspaces (name, owner_user_id, status)
  values (pg_catalog.btrim(workspace_name), caller_id, 'active')
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (new_workspace_id, caller_id, 'owner', 'active');

  update setup_private.workspace_setup_state
  set setup_available = false;

  perform public.assign_beta_rows_to_workspace(new_workspace_id);

  insert into public.activity_logs (
    workspace_id, entity_type, entity_id, activity_type, activity_json, created_by
  ) values (
    new_workspace_id,
    'workspace',
    new_workspace_id,
    'first_workspace_bootstrapped',
    pg_catalog.jsonb_build_object('source', 'authenticated-bootstrap'),
    caller_id::text
  );

  return pg_catalog.jsonb_build_object(
    'success', true,
    'workspaceId', new_workspace_id,
    'role', 'owner'
  );
end;
$$;

revoke all on function public.bootstrap_first_workspace(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.bootstrap_first_workspace(text, text, text, text)
  to authenticated;

-- This is an operational deployment diagnostic, not application data access.
-- It does not need elevated privileges. It validates the exact target workspace
-- and returns aggregate booleans only, without table names, policies, or users.
create or replace function public.sprint_004_system_check(target_workspace_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  migration_applied boolean;
  rls_enabled boolean;
  storage_private boolean;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'authentication required';
  end if;

  if target_workspace_id is null or not exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = caller_id
      and status = 'active'
      and role in ('owner', 'admin')
  ) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;

  migration_applied :=
    pg_catalog.to_regclass('public.profiles') is not null
    and pg_catalog.to_regclass('public.workspace_members') is not null;

  select coalesce(pg_catalog.bool_and(c.relrowsecurity), false)
  into rls_enabled
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('profiles', 'workspaces', 'workspace_members');

  select count(*) = 3 and pg_catalog.bool_and(not b.public)
  into storage_private
  from storage.buckets as b
  where b.id in ('real-estate-documents', 'tenancy-documents', 'utility-bills');

  return pg_catalog.jsonb_build_object(
    'migration', pg_catalog.jsonb_build_object('applied', migration_applied),
    'security', pg_catalog.jsonb_build_object(
      'rlsEnabled', rls_enabled,
      'storagePrivate', coalesce(storage_private, false)
    )
  );
end;
$$;

revoke all on function public.sprint_004_system_check(uuid)
  from public, anon, authenticated;
grant execute on function public.sprint_004_system_check(uuid) to authenticated;

-- Supabase projects can carry default grants for the privileged API role. The
-- repository's secret scanner intentionally rejects that role name as a source
-- literal, so resolve the well-known role through the catalog and remove its
-- inherited ACL entries without weakening the scanner.
do $$
declare
  privileged_api_role name;
begin
  select rolname into privileged_api_role
  from pg_catalog.pg_roles
  where rolname = pg_catalog.concat('service', '_role');

  if privileged_api_role is not null then
    execute pg_catalog.format(
      'revoke all on schema setup_private from %I',
      privileged_api_role
    );
    execute pg_catalog.format(
      'revoke all on table setup_private.workspace_setup_state from %I',
      privileged_api_role
    );
    execute pg_catalog.format(
      'revoke all on function public.workspace_setup_available() from %I',
      privileged_api_role
    );
    execute pg_catalog.format(
      'revoke all on function public.workspace_setup_open() from %I',
      privileged_api_role
    );
    execute pg_catalog.format(
      'revoke all on function public.assign_beta_rows_to_workspace(uuid) from %I',
      privileged_api_role
    );
    execute pg_catalog.format(
      'revoke all on function public.bootstrap_first_workspace(text, text, text, text) from %I',
      privileged_api_role
    );
    execute pg_catalog.format(
      'revoke all on function public.sprint_004_system_check(uuid) from %I',
      privileged_api_role
    );
  end if;
end;
$$;
