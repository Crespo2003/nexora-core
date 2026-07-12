create extension if not exists pgcrypto;

create table if not exists public.tenancies (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  landlord text not null,
  property text not null,
  monthly_rental numeric(12, 2) not null default 0 check (monthly_rental >= 0),
  deposit numeric(12, 2) not null default 0 check (deposit >= 0),
  utility_deposit numeric(12, 2) not null default 0 check (utility_deposit >= 0),
  access_card_deposit numeric(12, 2) not null default 0 check (access_card_deposit >= 0),
  commencement_date date not null,
  expiry_date date not null,
  renewal_reminder date,
  signed_ta text,
  renewal_history text,
  special_clauses text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenancies_valid_term check (expiry_date >= commencement_date)
);

create index if not exists tenancies_tenant_idx on public.tenancies (tenant);
create index if not exists tenancies_property_idx on public.tenancies (property);
create index if not exists tenancies_renewal_reminder_idx on public.tenancies (renewal_reminder);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_tenancies_updated_at on public.tenancies;
create trigger set_tenancies_updated_at
before update on public.tenancies
for each row
execute function public.set_updated_at();
