-- NON-EXECUTED REVIEW DRAFT.
-- Phase D verification. Read-only; requires a completed isolated rehearsal.

begin;
set transaction read only;
set local statement_timeout = '60s';

-- Structural gate: every required canonical table exists and has RLS.
with required(table_name) as (
  values
    ('contacts'),
    ('contact_roles'),
    ('tenancy_contacts'),
    ('contact_channels'),
    ('contact_follow_ups'),
    ('contact_communications'),
    ('collection_contact_preferences'),
    ('duplicate_decisions'),
    ('contact_audit_history'),
    ('crm_enquiries'),
    ('crm_deals'),
    ('crm_appointments'),
    ('crm_follow_ups'),
    ('crm_listing_matches'),
    ('crm_enquiry_stage_history'),
    ('crm_deal_stage_history')
)
select r.table_name,
       c.oid is not null as exists,
       coalesce(c.relrowsecurity, false) as rls_enabled,
       coalesce(c.relforcerowsecurity, false) as rls_forced
from required r
left join pg_class c
  on c.relname = r.table_name
 and c.relnamespace = 'public'::regnamespace
 and c.relkind in ('r','p')
order by r.table_name;

do $structure$
declare
  failure_count integer;
begin
  select count(*) into failure_count
  from unnest(array[
    'contacts','contact_roles','tenancy_contacts','contact_channels',
    'contact_follow_ups','contact_communications',
    'collection_contact_preferences','duplicate_decisions',
    'contact_audit_history','crm_enquiries','crm_deals',
    'crm_appointments','crm_follow_ups','crm_listing_matches',
    'crm_enquiry_stage_history','crm_deal_stage_history'
  ]) name
  left join pg_class c
    on c.relname = name
   and c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r','p')
  where c.oid is null or not c.relrowsecurity;

  if failure_count > 0 then
    raise exception 'VERIFY FAILED: % required tables missing or without RLS',
      failure_count;
  end if;
end
$structure$;

-- Verify no Data API access is granted to anonymous users and authenticated
-- users have only the privileges expected by the application.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'contacts','contact_roles','tenancy_contacts','contact_channels',
    'contact_follow_ups','contact_communications',
    'collection_contact_preferences','duplicate_decisions',
    'contact_audit_history','crm_enquiries','crm_deals',
    'crm_appointments','crm_follow_ups','crm_listing_matches',
    'crm_enquiry_stage_history','crm_deal_stage_history'
  )
  and grantee in ('anon','authenticated')
order by table_name, grantee, privilege_type;

do $anon_grants$
begin
  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in (
        'contacts','contact_roles','tenancy_contacts','contact_channels',
        'contact_follow_ups','contact_communications',
        'collection_contact_preferences','duplicate_decisions',
        'contact_audit_history','crm_enquiries','crm_deals',
        'crm_appointments','crm_follow_ups','crm_listing_matches',
        'crm_enquiry_stage_history','crm_deal_stage_history'
      )
      and grantee = 'anon'
  ) then
    raise exception 'VERIFY FAILED: anon retains a CRM/Contacts table grant';
  end if;
end
$anon_grants$;

-- Verify workspace-safe foreign keys.
select rel.relname as table_name,
       con.conname,
       pg_get_constraintdef(con.oid, true) as definition,
       con.convalidated
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace n on n.oid = rel.relnamespace
where n.nspname = 'public'
  and rel.relname in (
    'contact_roles','tenancy_contacts','contact_channels',
    'contact_follow_ups','contact_communications',
    'collection_contact_preferences','contact_audit_history',
    'crm_enquiries','crm_deals','crm_appointments','crm_follow_ups',
    'crm_listing_matches','crm_enquiry_stage_history',
    'crm_deal_stage_history'
  )
  and con.contype = 'f'
order by table_name, con.conname;

-- Verify policy matrix. Inspect the expressions, not just policy counts.
select tablename,
       policyname,
       cmd,
       roles,
       qual,
       with_check
from pg_policies
where schemaname = 'public'
  and (
    tablename like 'crm\_%' escape '\'
    or tablename in (
      'contacts','contact_roles','tenancy_contacts','contact_channels',
      'contact_follow_ups','contact_communications',
      'collection_contact_preferences','duplicate_decisions',
      'contact_audit_history'
    )
  )
order by tablename, policyname;

-- Verify trigger functions remain SECURITY INVOKER and are not executable by
-- PUBLIC/anon.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       has_function_privilege('public', p.oid, 'execute') as public_execute,
       has_function_privilege('anon', p.oid, 'execute') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'execute')
         as authenticated_execute
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'crm_stage_transition_allowed',
    'crm_record_stage_change',
    'crm_touch_updated_at'
  )
order by p.proname;

-- Verify business constraints and indexes exist.
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and (
    tablename like 'crm\_%' escape '\'
    or tablename like 'contact%'
    or tablename = 'tenancy_contacts'
    or tablename = 'collection_contact_preferences'
  )
order by tablename, indexname;

-- Orphan and cross-workspace checks must return zero.
select 'crm_enquiries/contact workspace mismatch' as check_name, count(*) failures
from public.crm_enquiries e
join public.contacts c on c.id = e.contact_id
where c.workspace_id <> e.workspace_id
union all
select 'crm_deals/contact workspace mismatch', count(*)
from public.crm_deals d
join public.contacts c on c.id = d.contact_id
where c.workspace_id <> d.workspace_id
union all
select 'crm_deals/enquiry workspace mismatch', count(*)
from public.crm_deals d
join public.crm_enquiries e on e.id = d.enquiry_id
where e.workspace_id <> d.workspace_id
union all
select 'appointment/contact workspace mismatch', count(*)
from public.crm_appointments a
join public.contacts c on c.id = a.contact_id
where c.workspace_id <> a.workspace_id
union all
select 'follow-up/enquiry workspace mismatch', count(*)
from public.crm_follow_ups f
join public.crm_enquiries e on e.id = f.enquiry_id
where e.workspace_id <> f.workspace_id
union all
select 'listing-match/enquiry workspace mismatch', count(*)
from public.crm_listing_matches m
join public.crm_enquiries e on e.id = m.enquiry_id
where e.workspace_id <> m.workspace_id;

-- Authenticated RLS test harness.
--
-- Run the block below once per role using real preview users. Set:
--   set local role authenticated;
--   set local "request.jwt.claims" =
--     '{"sub":"<USER_UUID>","role":"authenticated"}';
--
-- Then verify:
--   1. SELECT sees rows only in the user's active workspace.
--   2. INSERT to another workspace raises an RLS error.
--   3. UPDATE cannot move workspace_id.
--   4. Agent writes require assigned_user_id = auth.uid().
--   5. Manager can write; Finance and Viewer are read-only.
--   6. Owner/Admin can delete; other roles cannot.
--   7. A valid stage change writes exactly one history row.
--   8. An invalid stage change raises SQLSTATE 23514.
--
-- The test requires two distinct workspace UUIDs and users. It cannot be
-- honestly completed with service-role or postgres credentials because those
-- roles bypass the application RLS boundary.

rollback;
