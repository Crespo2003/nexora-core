-- Sprint 008: multi-tenant SaaS onboarding and workspace provisioning.
-- All privileged entry points derive the caller from auth.uid(), use an empty
-- search_path, revoke PUBLIC/anon execution, and return only safe summaries.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

alter table public.workspaces
  add column if not exists business_type text not null default 'property_management',
  add column if not exists country text not null default 'MY',
  add column if not exists timezone text not null default 'Asia/Kuala_Lumpur',
  add column if not exists preferred_currency text not null default 'MYR',
  add column if not exists preferred_language text not null default 'en',
  add column if not exists company_registration_number text,
  add column if not exists contact_number text;

alter table public.workspace_members drop constraint if exists workspace_members_status_check;
alter table public.workspace_members add constraint workspace_members_status_check
  check (status in ('active', 'invited', 'disabled', 'suspended'));

create table if not exists public.onboarding_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, idempotency_key)
);

create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'manager', 'agent', 'finance', 'viewer')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_by uuid references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create unique index if not exists workspace_invitations_active_email_idx
  on public.workspace_invitations (workspace_id, lower(email))
  where status = 'pending';
create index if not exists onboarding_attempts_user_idx on public.onboarding_attempts (user_id, created_at desc);
create index if not exists workspace_invitations_token_idx on public.workspace_invitations (token_hash);
create index if not exists workspace_invitations_email_idx on public.workspace_invitations (lower(email), status);

-- Canonical SaaS terminology without breaking the existing application table.
-- This read-only security-invoker view obeys workspace_members RLS.
create or replace view public.workspace_memberships
with (security_invoker = true)
as select id, workspace_id, user_id, role, status, created_at, updated_at
from public.workspace_members;
revoke all on public.workspace_memberships from public, anon, authenticated;
grant select on public.workspace_memberships to authenticated;

alter table public.onboarding_attempts enable row level security;
alter table public.workspace_invitations enable row level security;

revoke all on public.onboarding_attempts from public, anon, authenticated;
revoke all on public.workspace_invitations from public, anon, authenticated;
grant select on public.workspace_invitations to authenticated;

drop policy if exists "users read own onboarding attempts" on public.onboarding_attempts;
create policy "users read own onboarding attempts"
  on public.onboarding_attempts for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "workspace invitation participants read" on public.workspace_invitations;
create policy "workspace invitation participants read"
  on public.workspace_invitations for select to authenticated
  using (
    invited_by = (select auth.uid())
    or lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
    or public.has_workspace_role(workspace_id, array['owner', 'admin'])
  );

-- A user must always be able to read their own membership, including a
-- suspended one, so application routing can deny it explicitly.
drop policy if exists "workspace members read" on public.workspace_members;
create policy "workspace members read" on public.workspace_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_workspace_member(workspace_id)
  );

-- Prevent deletion or demotion of the final active owner. Ownership transfer
-- must first create/activate another owner membership.
create or replace function app_private.protect_final_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_owners integer;
begin
  if old.role = 'owner' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active') then
    select count(*) into remaining_owners
    from public.workspace_members
    where workspace_id = old.workspace_id
      and role = 'owner'
      and status = 'active'
      and id <> old.id;
    if remaining_owners = 0 then
      raise exception using errcode = '23514', message = 'final_owner_required';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function app_private.protect_final_workspace_owner() from public, anon, authenticated;

drop trigger if exists protect_final_workspace_owner on public.workspace_members;
create trigger protect_final_workspace_owner
before update or delete on public.workspace_members
for each row execute function app_private.protect_final_workspace_owner();

-- New auth users get a non-authoritative profile. Authorization never reads
-- user_metadata; it is copied only into display/preferences fields.
create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, preferred_language)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 160),
    case when new.raw_user_meta_data ->> 'preferred_language' in ('en', 'zh', 'ms')
      then new.raw_user_meta_data ->> 'preferred_language' else 'en' end
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;
revoke all on function app_private.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_nexora_profile on auth.users;
create trigger on_auth_user_created_nexora_profile
after insert on auth.users
for each row execute function app_private.handle_new_user();

create or replace function public.provision_workspace(
  workspace_name text,
  business_type text,
  country text,
  timezone text,
  preferred_currency text,
  preferred_language text,
  company_registration_number text,
  contact_number text,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  existing_workspace public.workspaces%rowtype;
  new_workspace_id uuid;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if idempotency_key is null then
    raise exception using errcode = '22023', message = 'idempotency_key_required';
  end if;
  if nullif(pg_catalog.btrim(workspace_name), '') is null
     or pg_catalog.char_length(pg_catalog.btrim(workspace_name)) > 120 then
    raise exception using errcode = '22023', message = 'invalid_workspace_name';
  end if;
  if nullif(pg_catalog.btrim(business_type), '') is null
     or nullif(pg_catalog.btrim(country), '') is null
     or nullif(pg_catalog.btrim(timezone), '') is null
     or preferred_currency !~ '^[A-Z]{3}$'
     or preferred_language not in ('en', 'zh', 'ms') then
    raise exception using errcode = '22023', message = 'invalid_workspace_details';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text || ':' || idempotency_key::text, 0)
  );

  select w.* into existing_workspace
  from public.onboarding_attempts a
  join public.workspaces w on w.id = a.workspace_id
  where a.user_id = caller_id and a.idempotency_key = provision_workspace.idempotency_key
    and a.status = 'completed';
  if found then
    return pg_catalog.jsonb_build_object(
      'workspaceId', existing_workspace.id,
      'name', existing_workspace.name,
      'role', 'owner',
      'idempotentReplay', true
    );
  end if;

  insert into public.onboarding_attempts (user_id, idempotency_key, status)
  values (caller_id, idempotency_key, 'pending')
  on conflict (user_id, idempotency_key) do update set error_code = null;

  insert into public.workspaces (
    name, owner_user_id, status, business_type, country, timezone,
    preferred_currency, preferred_language, company_registration_number, contact_number
  ) values (
    pg_catalog.btrim(workspace_name), caller_id, 'active', pg_catalog.btrim(business_type),
    upper(pg_catalog.btrim(country)), pg_catalog.btrim(timezone), upper(preferred_currency),
    preferred_language, nullif(pg_catalog.btrim(company_registration_number), ''),
    nullif(pg_catalog.btrim(contact_number), '')
  ) returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (new_workspace_id, caller_id, 'owner', 'active');

  update public.onboarding_attempts
  set workspace_id = new_workspace_id, status = 'completed', completed_at = now()
  where user_id = caller_id and idempotency_key = provision_workspace.idempotency_key;

  insert into public.activity_logs (
    workspace_id, entity_type, entity_id, activity_type, activity_json, created_by
  ) values (
    new_workspace_id, 'workspace', new_workspace_id, 'workspace_provisioned',
    pg_catalog.jsonb_build_object('source', 'saas-onboarding'), caller_id::text
  );

  return pg_catalog.jsonb_build_object(
    'workspaceId', new_workspace_id,
    'name', pg_catalog.btrim(workspace_name),
    'role', 'owner',
    'idempotentReplay', false
  );
end;
$$;
revoke all on function public.provision_workspace(text, text, text, text, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.provision_workspace(text, text, text, text, text, text, text, text, uuid)
  to authenticated;

create or replace function public.create_workspace_invitation(
  target_workspace_id uuid,
  invite_email text,
  invite_role text,
  expiry_hours integer default 72
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  normalized_email text := lower(pg_catalog.btrim(invite_email));
  raw_token text;
  invitation_id uuid;
  expiry timestamptz;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = caller_id
      and role in ('owner', 'admin') and status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'invitation_forbidden';
  end if;
  if invite_role not in ('admin', 'manager', 'agent', 'finance', 'viewer') then
    raise exception using errcode = '22023', message = 'invalid_invitation_role';
  end if;
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'invalid_invitation_email';
  end if;
  if expiry_hours < 1 or expiry_hours > 168 then
    raise exception using errcode = '22023', message = 'invalid_invitation_expiry';
  end if;
  if exists (
    select 1 from public.workspace_members wm join auth.users u on u.id = wm.user_id
    where wm.workspace_id = target_workspace_id and lower(u.email) = normalized_email
      and wm.status = 'active'
  ) then
    raise exception using errcode = '23505', message = 'already_a_workspace_member';
  end if;

  update public.workspace_invitations set status = 'expired'
  where workspace_id = target_workspace_id and lower(email) = normalized_email
    and status = 'pending' and expires_at <= now();

  raw_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'base64');
  expiry := now() + pg_catalog.make_interval(hours => expiry_hours);
  insert into public.workspace_invitations (
    workspace_id, email, role, token_hash, invited_by, expires_at
  ) values (
    target_workspace_id, normalized_email, invite_role,
    pg_catalog.encode(extensions.digest(raw_token, 'sha256'), 'hex'), caller_id, expiry
  ) returning id into invitation_id;

  insert into public.activity_logs (
    workspace_id, entity_type, entity_id, activity_type, activity_json, created_by
  ) values (
    target_workspace_id, 'workspace_invitation', invitation_id, 'workspace_invitation_created',
    pg_catalog.jsonb_build_object('email', normalized_email, 'role', invite_role, 'expiresAt', expiry),
    caller_id::text
  );

  return pg_catalog.jsonb_build_object(
    'invitationId', invitation_id, 'token', raw_token, 'email', normalized_email,
    'role', invite_role, 'expiresAt', expiry
  );
exception when unique_violation then
  raise exception using errcode = '23505', message = 'active_invitation_exists';
end;
$$;
revoke all on function public.create_workspace_invitation(uuid, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.create_workspace_invitation(uuid, text, text, integer)
  to authenticated;

create or replace function public.accept_workspace_invitation(invitation_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  caller_email text;
  invitation public.workspace_invitations%rowtype;
begin
  if caller_id is null then
    raise exception using errcode = '28000', message = 'authentication_required';
  end if;
  select lower(email) into caller_email from auth.users where id = caller_id;
  if caller_email is null then
    raise exception using errcode = '28000', message = 'verified_email_required';
  end if;

  select * into invitation from public.workspace_invitations
  where token_hash = pg_catalog.encode(extensions.digest(invitation_token, 'sha256'), 'hex')
  for update;
  if not found or invitation.status <> 'pending' then
    raise exception using errcode = '22023', message = 'invitation_invalid';
  end if;
  if invitation.expires_at <= now() then
    update public.workspace_invitations set status = 'expired' where id = invitation.id;
    raise exception using errcode = '22023', message = 'invitation_expired';
  end if;
  if lower(invitation.email) <> caller_email then
    raise exception using errcode = '42501', message = 'invitation_email_mismatch';
  end if;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (invitation.workspace_id, caller_id, invitation.role, 'active')
  on conflict (workspace_id, user_id) do update
    set status = 'active', role = excluded.role, updated_at = now();

  update public.workspace_invitations
  set status = 'accepted', accepted_by = caller_id, accepted_at = now()
  where id = invitation.id;

  insert into public.activity_logs (
    workspace_id, entity_type, entity_id, activity_type, activity_json, created_by
  ) values (
    invitation.workspace_id, 'workspace_invitation', invitation.id, 'workspace_invitation_accepted',
    pg_catalog.jsonb_build_object('role', invitation.role), caller_id::text
  );

  return pg_catalog.jsonb_build_object(
    'workspaceId', invitation.workspace_id, 'role', invitation.role
  );
end;
$$;
revoke all on function public.accept_workspace_invitation(text) from public, anon, authenticated;
grant execute on function public.accept_workspace_invitation(text) to authenticated;

-- The obsolete global customer bootstrap is no longer callable. Existing data
-- remains intact, and the compatibility status helper always reports closed.
revoke all on function public.bootstrap_first_workspace(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.workspace_setup_open() from public, anon, authenticated;
revoke all on function public.workspace_setup_available() from public, anon, authenticated;

create or replace function public.workspace_setup_available()
returns boolean language sql stable security invoker set search_path = ''
as $$ select false; $$;
revoke all on function public.workspace_setup_available() from public, anon, authenticated;

-- Avoid default privileges making future functions executable by PUBLIC.
alter default privileges in schema public revoke execute on functions from public;
