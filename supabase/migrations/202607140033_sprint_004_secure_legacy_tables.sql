-- Sprint 004: quarantine and workspace-secure the two retained legacy tables.
-- Existing unmapped rows are preserved. When exactly one workspace exists they
-- are mapped automatically; otherwise an administrator must map them manually.

alter table public.properties add column if not exists workspace_id uuid;
alter table public.listing_memory add column if not exists workspace_id uuid;

do $$
declare
  only_workspace_id uuid;
begin
  if (select count(*) from public.workspaces) = 1 then
    select id into only_workspace_id from public.workspaces limit 1;
    update public.properties set workspace_id = only_workspace_id where workspace_id is null;
    update public.listing_memory set workspace_id = only_workspace_id where workspace_id is null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.properties'::regclass
      and conname = 'properties_workspace_id_fkey'
  ) then
    alter table public.properties
      add constraint properties_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.listing_memory'::regclass
      and conname = 'listing_memory_workspace_id_fkey'
  ) then
    alter table public.listing_memory
      add constraint listing_memory_workspace_id_fkey
      foreign key (workspace_id) references public.workspaces(id) on delete restrict;
  end if;
end;
$$;

-- NOT VALID preserves ambiguous legacy rows while enforcing ownership for every
-- new or changed row. Validate these constraints after manual mapping is complete.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.properties'::regclass
      and conname = 'properties_workspace_required'
  ) then
    alter table public.properties
      add constraint properties_workspace_required
      check (workspace_id is not null) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.listing_memory'::regclass
      and conname = 'listing_memory_workspace_required'
  ) then
    alter table public.listing_memory
      add constraint listing_memory_workspace_required
      check (workspace_id is not null) not valid;
  end if;
end;
$$;

create index if not exists properties_workspace_id_idx
  on public.properties (workspace_id);
create index if not exists listing_memory_workspace_id_idx
  on public.listing_memory (workspace_id);

create or replace function public.prevent_legacy_workspace_reassignment()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if old.workspace_id is distinct from new.workspace_id and auth.uid() is not null then
    raise exception 'workspace ownership cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_legacy_workspace_reassignment() from public, anon;
grant execute on function public.prevent_legacy_workspace_reassignment() to authenticated;

drop trigger if exists properties_workspace_immutable on public.properties;
create trigger properties_workspace_immutable
before update of workspace_id on public.properties
for each row execute function public.prevent_legacy_workspace_reassignment();

drop trigger if exists listing_memory_workspace_immutable on public.listing_memory;
create trigger listing_memory_workspace_immutable
before update of workspace_id on public.listing_memory
for each row execute function public.prevent_legacy_workspace_reassignment();

do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('properties', 'listing_memory')
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end;
$$;

alter table public.properties enable row level security;
alter table public.properties force row level security;
alter table public.listing_memory enable row level security;
alter table public.listing_memory force row level security;

revoke all on public.properties from public, anon;
revoke all on public.listing_memory from public, anon;
revoke all on public.properties from authenticated;
revoke all on public.listing_memory from authenticated;
grant select, insert, update, delete on public.properties to authenticated;
grant select, insert, update, delete on public.listing_memory to authenticated;

create policy "properties workspace read"
on public.properties for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "properties operational insert"
on public.properties for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner','admin','manager','agent']));

create policy "properties operational update"
on public.properties for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner','admin','manager','agent']))
with check (public.has_workspace_role(workspace_id, array['owner','admin','manager','agent']));

create policy "properties admin delete"
on public.properties for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner','admin']));

create policy "listing memory workspace read"
on public.listing_memory for select to authenticated
using (public.is_workspace_member(workspace_id));

create policy "listing memory operational insert"
on public.listing_memory for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner','admin','manager','agent']));

create policy "listing memory operational update"
on public.listing_memory for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner','admin','manager','agent']))
with check (public.has_workspace_role(workspace_id, array['owner','admin','manager','agent']));

create policy "listing memory admin delete"
on public.listing_memory for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner','admin']));

create or replace function public.sprint_004_system_check(target_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  required_tables text[] := array[
    'profiles','workspaces','workspace_members','tenancies','rental_collections','documents',
    'document_extractions','document_links','import_jobs','utility_accounts','utility_bills',
    'collection_payments','collection_reminders','collection_followups','activity_logs',
    'properties','listing_memory'
  ];
  required_workspace_tables text[] := array[
    'tenancies','rental_collections','documents','document_extractions','document_links','import_jobs',
    'utility_accounts','utility_account_history','utility_bills','collection_payments',
    'collection_reminders','collection_followups','collection_adjustments','activity_logs',
    'properties','listing_memory'
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
        where table_schema = 'public'
          and information_schema.columns.table_name = table_list.table_name
          and column_name = 'workspace_id'
      ))
      from unnest(required_workspace_tables) as table_list(table_name)
    ),
    'rls', (
      select jsonb_object_agg(c.relname, c.relrowsecurity)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any(required_tables)
    ),
    'legacyTables', jsonb_build_object(
      'properties', jsonb_build_object(
        'workspaceOwnership', case when exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'properties' and column_name = 'workspace_id'
        ) then 'Passed' else 'Failed' end,
        'rls', case when coalesce((
          select c.relrowsecurity from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'properties'
        ), false) then 'Passed' else 'Failed' end,
        'policies', case when (
          select count(*) from pg_policies
          where schemaname = 'public' and tablename = 'properties'
        ) = 4 then 'Passed' else 'Failed' end,
        'anonymousAccess', case when exists (
          select 1 from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'properties' and grantee in ('anon','PUBLIC')
        ) then 'Failed' else 'Passed' end,
        'mapping', case when exists (
          select 1 from public.properties where workspace_id is null
        ) then 'Warning' else 'Passed' end
      ),
      'listingMemory', jsonb_build_object(
        'workspaceOwnership', case when exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'listing_memory' and column_name = 'workspace_id'
        ) then 'Passed' else 'Failed' end,
        'rls', case when coalesce((
          select c.relrowsecurity from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'listing_memory'
        ), false) then 'Passed' else 'Failed' end,
        'policies', case when (
          select count(*) from pg_policies
          where schemaname = 'public' and tablename = 'listing_memory'
        ) = 4 then 'Passed' else 'Failed' end,
        'anonymousAccess', case when exists (
          select 1 from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'listing_memory' and grantee in ('anon','PUBLIC')
        ) then 'Failed' else 'Passed' end,
        'mapping', case when exists (
          select 1 from public.listing_memory where workspace_id is null
        ) then 'Warning' else 'Passed' end
      )
    ),
    'buckets', (
      select jsonb_object_agg(id, jsonb_build_object('configured', true, 'public', public))
      from storage.buckets
      where id in ('real-estate-documents', 'tenancy-documents', 'utility-bills')
    ),
    'migration', jsonb_build_object(
      'name', '202607140033_sprint_004_secure_legacy_tables',
      'applied', (
        to_regclass('public.profiles') is not null
        and exists (
          select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'properties' and c.relrowsecurity
        )
        and exists (
          select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = 'listing_memory' and c.relrowsecurity
        )
        and exists (select 1 from storage.buckets where id = 'real-estate-documents' and public = false)
      )
    )
  );
end;
$$;

revoke all on function public.sprint_004_system_check(uuid) from public, anon;
grant execute on function public.sprint_004_system_check(uuid) to authenticated;
