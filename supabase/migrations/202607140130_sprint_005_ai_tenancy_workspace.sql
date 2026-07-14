-- Sprint 005 AI Tenancy Workspace.
-- Additive profile fields only; existing Sprint 001-004 behavior is unchanged.

alter table public.tenancies
  add column if not exists tenant_nationality text not null default '',
  add column if not exists tenant_emergency_contact text not null default '',
  add column if not exists tenant_company text not null default '',
  add column if not exists tenant_occupation text not null default '',
  add column if not exists move_in_date date,
  add column if not exists landlord_bank_account text not null default '',
  add column if not exists landlord_emergency_contact text not null default '',
  add column if not exists landlord_preferred_language text not null default 'en',
  add column if not exists occupancy_status text not null default 'occupied';

update public.tenancies
set
  move_in_date = coalesce(move_in_date, commencement_date),
  landlord_preferred_language = coalesce(nullif(landlord_preferred_language, ''), preferred_language, 'en'),
  occupancy_status = case
    when status in ('expired', 'terminated', 'draft') then 'vacant'
    else occupancy_status
  end;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenancies'::regclass
      and conname = 'tenancies_occupancy_status_valid'
  ) then
    alter table public.tenancies
      add constraint tenancies_occupancy_status_valid
      check (occupancy_status in ('occupied', 'vacant'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenancies'::regclass
      and conname = 'tenancies_landlord_language_valid'
  ) then
    alter table public.tenancies
      add constraint tenancies_landlord_language_valid
      check (landlord_preferred_language in ('en', 'zh', 'bilingual'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenancies'::regclass
      and conname = 'tenancies_move_in_date_valid'
  ) then
    alter table public.tenancies
      add constraint tenancies_move_in_date_valid
      check (move_in_date is null or move_in_date <= expiry_date);
  end if;
end;
$$;

create index if not exists tenancies_occupancy_status_idx
  on public.tenancies (workspace_id, occupancy_status);

create index if not exists tenancies_workspace_search_idx
  on public.tenancies using gin (
    to_tsvector(
      'simple',
      coalesce(tenant, '') || ' ' ||
      coalesce(landlord, '') || ' ' ||
      coalesce(tenant_id_no, '') || ' ' ||
      coalesce(tenant_phone, '') || ' ' ||
      coalesce(property, '') || ' ' ||
      coalesce(unit_no, '')
    )
  );
