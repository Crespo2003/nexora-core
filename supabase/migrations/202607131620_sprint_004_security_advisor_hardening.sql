-- Sprint 004 security advisor hardening.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function private.has_workspace_role(target_workspace_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
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

revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.has_workspace_role(uuid, text[]) from public, anon;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.has_workspace_role(uuid, text[]) to authenticated;

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = private, pg_catalog
as $$
  select private.is_workspace_member(target_workspace_id);
$$;

create or replace function public.has_workspace_role(target_workspace_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security invoker
set search_path = private, pg_catalog
as $$
  select private.has_workspace_role(target_workspace_id, allowed_roles);
$$;

revoke all on public.profiles from anon, public;
revoke all on public.workspace_members from anon, public;

revoke all on function public.assign_beta_rows_to_workspace(uuid) from anon, authenticated;

alter function public.set_updated_at() set search_path = pg_catalog;
alter function public.sync_rental_collection_totals() set search_path = public, pg_catalog;
alter function public.storage_workspace_id(text) set search_path = pg_catalog;
