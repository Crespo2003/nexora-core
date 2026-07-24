-- NON-EXECUTED REVIEW DRAFT.
-- Run only against the explicitly confirmed target after Gates 1-3.
-- This script is read-only and raises an exception on unsafe state.

begin;
set transaction read only;
set local statement_timeout = '60s';
set local lock_timeout = '5s';

-- Freeze identity and migration ledger.
select current_database() as database_name,
       current_user as inspected_as,
       current_setting('server_version') as postgres_version,
       clock_timestamp() as inspected_at;

select version,
       name,
       cardinality(statements) as statement_count,
       encode(
         extensions.digest(coalesce(array_to_string(statements, E'\n'), ''), 'sha256'),
         'hex'
       ) as statement_sha256
from supabase_migrations.schema_migrations
order by version;

-- Complete public object inventory.
select n.nspname as schema_name,
       c.relname as object_name,
       case c.relkind
         when 'r' then 'table'
         when 'p' then 'partitioned table'
         when 'v' then 'view'
         when 'm' then 'materialized view'
         when 'S' then 'sequence'
         else c.relkind::text
       end as object_type,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       pg_get_userbyid(c.relowner) as owner
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r','p','v','m','S')
order by object_type, object_name;

select c.table_name,
       c.ordinal_position,
       c.column_name,
       c.data_type,
       c.udt_name,
       c.is_nullable,
       c.column_default,
       c.is_identity,
       c.is_generated,
       c.generation_expression
from information_schema.columns c
where c.table_schema = 'public'
order by c.table_name, c.ordinal_position;

select rel.relname as table_name,
       con.conname as constraint_name,
       con.contype as constraint_type,
       con.convalidated as validated,
       pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public'
order by table_name, constraint_name;

select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

select tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual as using_expression,
       with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select event_object_table as table_name,
       trigger_name,
       action_timing,
       event_manipulation,
       action_statement
from information_schema.triggers
where trigger_schema = 'public'
order by table_name, trigger_name, event_manipulation;

select n.nspname as schema_name,
       p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as identity_arguments,
       pg_get_function_result(p.oid) as result_type,
       l.lanname as language,
       p.prosecdef as security_definer,
       p.provolatile as volatility,
       pg_get_userbyid(p.proowner) as owner,
       p.proacl as acl,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname in ('public', 'private', 'app_private')
order by schema_name, function_name, identity_arguments;

select table_name, grantee, privilege_type, is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon','authenticated','service_role')
order by table_name, grantee, privilege_type;

select routine_schema,
       routine_name,
       grantee,
       privilege_type,
       is_grantable
from information_schema.role_routine_grants
where routine_schema in ('public','private','app_private')
  and grantee in ('PUBLIC','anon','authenticated','service_role')
order by routine_schema, routine_name, grantee;

-- Named target-state presence matrix.
with requested(object_name) as (
  values
    ('workspaces'),('workspace_members'),('contacts'),('companies'),
    ('commercial_companies'),('commercial_contacts'),
    ('commercial_requirements'),('commercial_listings'),('commercial_deals'),
    ('tenancies'),('rental_collections'),('tenancy_documents'),
    ('tenancy_extractions'),('documents'),('document_links'),
    ('document_activity'),('document_extractions'),
    ('tenancy_legal_analyses'),('tenancy_legal_clause_categories'),
    ('tenancy_legal_clauses'),('tenancy_legal_risks'),
    ('tenancy_agreement_comparisons'),
    ('tenancy_agreement_comparison_findings'),
    ('clients'),('enquiries'),('enquiry_listing_matches'),
    ('appointments'),('follow_ups'),('deals'),('deal_stage_history'),
    ('crm_enquiries'),('crm_listing_matches'),('crm_appointments'),
    ('crm_follow_ups'),('crm_deals'),('crm_enquiry_stage_history'),
    ('crm_deal_stage_history')
)
select object_name,
       to_regclass(format('public.%I', object_name)) is not null as exists_remotely
from requested
order by object_name;

-- Data-safety report.
select 'tenancies.workspace_id is null' as check_name, count(*) as failures
from public.tenancies where workspace_id is null
union all
select 'documents.workspace_id is null', count(*)
from public.documents where workspace_id is null
union all
select 'rental_collections.workspace_id is null', count(*)
from public.rental_collections where workspace_id is null
union all
select 'invalid tenancy date range', count(*)
from public.tenancies where expiry_date <= commencement_date
union all
select 'orphan tenancy workspace', count(*)
from public.tenancies t
left join public.workspaces w on w.id = t.workspace_id
where t.workspace_id is not null and w.id is null
union all
select 'orphan document workspace', count(*)
from public.documents d
left join public.workspaces w on w.id = d.workspace_id
where d.workspace_id is not null and w.id is null
union all
select 'duplicate workspace document hash', count(*)
from (
  select workspace_id, document_hash
  from public.documents
  where workspace_id is not null and coalesce(document_hash, '') <> ''
  group by workspace_id, document_hash
  having count(*) > 1
) duplicates;

-- Hard blockers. This block performs no writes.
do $preflight$
declare
  failure_count bigint;
  crm_present integer;
  contacts_present integer;
begin
  select count(*) into failure_count
  from public.tenancies
  where workspace_id is null or expiry_date <= commencement_date;
  if failure_count > 0 then
    raise exception 'PRECHECK BLOCKED: % invalid or unscoped tenancy rows', failure_count;
  end if;

  select count(*) into failure_count
  from public.documents d
  left join public.workspaces w on w.id = d.workspace_id
  where d.workspace_id is null or w.id is null;
  if failure_count > 0 then
    raise exception 'PRECHECK BLOCKED: % unscoped or orphan document rows', failure_count;
  end if;

  select count(*) into failure_count
  from (
    select workspace_id, document_hash
    from public.documents
    where workspace_id is not null and coalesce(document_hash, '') <> ''
    group by workspace_id, document_hash
    having count(*) > 1
  ) duplicates;
  if failure_count > 0 then
    raise exception 'PRECHECK BLOCKED: % duplicate workspace/document hashes', failure_count;
  end if;

  select count(*) into crm_present
  from unnest(array[
    'crm_enquiries','crm_deals','crm_appointments','crm_follow_ups',
    'crm_listing_matches','crm_enquiry_stage_history',
    'crm_deal_stage_history'
  ]) name
  where to_regclass(format('public.%I', name)) is not null;
  if crm_present not in (0, 7) then
    raise exception 'PRECHECK BLOCKED: partial CRM schema detected (% of 7 tables)', crm_present;
  end if;

  select count(*) into contacts_present
  from unnest(array[
    'contacts','contact_roles','tenancy_contacts','contact_channels',
    'contact_follow_ups','contact_communications',
    'collection_contact_preferences','duplicate_decisions',
    'contact_audit_history'
  ]) name
  where to_regclass(format('public.%I', name)) is not null;
  if contacts_present not in (0, 9) then
    raise exception 'PRECHECK BLOCKED: partial Contacts schema detected (% of 9 tables)', contacts_present;
  end if;
end
$preflight$;

rollback;
