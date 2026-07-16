-- SPRINT 008 POST-MIGRATION VALIDATION (READ ONLY)
-- Every boolean in the first four result sets should be true unless noted.

select
  pg_catalog.to_regclass('public.onboarding_attempts') is not null as onboarding_attempts_exists,
  pg_catalog.to_regclass('public.workspace_invitations') is not null as workspace_invitations_exists,
  pg_catalog.to_regclass('public.workspace_memberships') is not null as memberships_view_exists,
  exists (select 1 from pg_catalog.pg_namespace where nspname = 'app_private') as private_schema_exists;

select
  bool_and(rel.relrowsecurity) as all_new_tables_have_rls
from pg_catalog.pg_class rel
join pg_catalog.pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public'
  and rel.relname in ('onboarding_attempts', 'workspace_invitations');

select
  has_function_privilege('authenticated', 'public.provision_workspace(text,text,text,text,text,text,text,text,uuid)', 'EXECUTE') as authenticated_can_provision,
  not has_function_privilege('anon', 'public.provision_workspace(text,text,text,text,text,text,text,text,uuid)', 'EXECUTE') as anon_cannot_provision,
  has_function_privilege('authenticated', 'public.create_workspace_invitation(uuid,text,text,integer)', 'EXECUTE') as authenticated_can_invite,
  not has_function_privilege('anon', 'public.create_workspace_invitation(uuid,text,text,integer)', 'EXECUTE') as anon_cannot_invite,
  has_function_privilege('authenticated', 'public.accept_workspace_invitation(text)', 'EXECUTE') as authenticated_can_accept,
  not has_function_privilege('anon', 'public.accept_workspace_invitation(text)', 'EXECUTE') as anon_cannot_accept,
  not has_function_privilege('authenticated', 'public.bootstrap_first_workspace(text,text,text,text)', 'EXECUTE') as legacy_bootstrap_is_closed,
  not has_function_privilege('anon', 'public.workspace_setup_available()', 'EXECUTE') as public_setup_status_is_closed;

select
  p.proname,
  p.prosecdef as is_security_definer,
  p.proconfig @> array['search_path=""']::text[] as empty_search_path
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('provision_workspace', 'create_workspace_invitation', 'accept_workspace_invitation')
order by p.proname;
-- Expected: exactly three rows; both booleans true on every row.

select
  pg_catalog.to_regclass('public.workspace_memberships') is not null as view_exists,
  coalesce(rel.reloptions @> array['security_invoker=true']::text[], false) as view_uses_invoker_security
from pg_catalog.pg_class rel
join pg_catalog.pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public' and rel.relname = 'workspace_memberships';

select
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'protect_final_workspace_owner' and not tgisinternal
  ) as final_owner_trigger_exists,
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgname = 'on_auth_user_created_nexora_profile' and not tgisinternal
  ) as profile_trigger_exists,
  exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'workspace_invitations_active_email_idx'
  ) as duplicate_invitation_index_exists;

select
  c.table_name,
  c.column_name
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'workspaces'
  and c.column_name in (
    'business_type', 'country', 'timezone', 'preferred_currency',
    'preferred_language', 'company_registration_number', 'contact_number'
  )
order by c.column_name;
-- Expected: seven rows.

select
  (select count(*) from public.profiles) as profiles_after,
  (select count(*) from public.workspaces) as workspaces_after,
  (select count(*) from public.workspace_members) as memberships_after,
  (select count(*) from public.activity_logs) as activity_logs_after;
-- Before live acceptance starts, these must match the saved pre-flight counts.
