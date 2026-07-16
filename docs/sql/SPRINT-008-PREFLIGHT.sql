-- SPRINT 008 PRE-FLIGHT (READ ONLY)
-- Run in Supabase SQL Editor before applying the Sprint 008 migration.

select
  current_database() as database_name,
  current_setting('server_version') as postgres_version,
  now() as checked_at;

select
  (select count(*) from public.profiles) as profiles_before,
  (select count(*) from public.workspaces) as workspaces_before,
  (select count(*) from public.workspace_members) as memberships_before,
  (select count(*) from public.activity_logs) as activity_logs_before;

select
  pg_catalog.to_regclass('public.profiles') is not null as profiles_exists,
  pg_catalog.to_regclass('public.workspaces') is not null as workspaces_exists,
  pg_catalog.to_regclass('public.workspace_members') is not null as workspace_members_exists,
  pg_catalog.to_regclass('public.activity_logs') is not null as activity_logs_exists,
  pg_catalog.to_regclass('setup_private.workspace_setup_state') is not null as sprint_007_hardening_present;

select
  e.extname,
  n.nspname as extension_schema
from pg_catalog.pg_extension e
join pg_catalog.pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pgcrypto';
-- Expected for the connected project: pgcrypto | extensions

select
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable
from information_schema.columns c
where c.table_schema = 'public'
  and (
    (c.table_name = 'workspaces' and c.column_name in ('id', 'name', 'owner_user_id', 'status'))
    or (c.table_name = 'workspace_members' and c.column_name in ('id', 'workspace_id', 'user_id', 'role', 'status'))
    or (c.table_name = 'activity_logs' and c.column_name in ('workspace_id', 'entity_id', 'activity_json', 'created_by'))
  )
order by c.table_name, c.ordinal_position;

select
  n.nspname as schema_name,
  p.proname,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
  case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end as security_mode,
  p.proconfig
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'bootstrap_first_workspace',
    'workspace_setup_open',
    'workspace_setup_available',
    'is_workspace_member',
    'has_workspace_role'
  )
order by p.proname;

select
  has_function_privilege('anon', 'public.bootstrap_first_workspace(text,text,text,text)', 'EXECUTE') as anon_can_bootstrap,
  has_function_privilege('authenticated', 'public.bootstrap_first_workspace(text,text,text,text)', 'EXECUTE') as authenticated_can_bootstrap,
  has_function_privilege('anon', 'public.workspace_setup_available()', 'EXECUTE') as anon_can_read_setup_status;
-- Current connected-project expectation before Sprint 008: false | true | true.
-- Post-migration all three must be false.

select
  rel.relname as table_name,
  rel.relrowsecurity as rls_enabled
from pg_catalog.pg_class rel
join pg_catalog.pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public'
  and rel.relkind = 'r'
order by rel.relname;
-- Stop if any exposed application table reports rls_enabled = false.
