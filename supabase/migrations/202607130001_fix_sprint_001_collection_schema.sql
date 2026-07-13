create extension if not exists pgcrypto;

alter table public.rental_collections
  add column if not exists rental_amount numeric(12, 2) not null default 0,
  add column if not exists tnb_amount numeric(12, 2) not null default 0,
  add column if not exists water_amount numeric(12, 2) not null default 0,
  add column if not exists iwk_amount numeric(12, 2) not null default 0,
  add column if not exists wifi_amount numeric(12, 2) not null default 0,
  add column if not exists aircond_amount numeric(12, 2) not null default 0,
  add column if not exists other_charges numeric(12, 2) not null default 0,
  add column if not exists amount_paid numeric(12, 2) not null default 0,
  add column if not exists payment_status text not null default 'outstanding',
  add column if not exists payment_date date,
  add column if not exists payment_method text not null default '',
  add column if not exists payment_reference text not null default '',
  add column if not exists notes text not null default '',
  add column if not exists payment_history jsonb not null default '[]'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rental_collections' and column_name = 'amount_due'
  ) then
    update public.rental_collections
    set rental_amount = coalesce(nullif(rental_amount, 0), amount_due)
    where rental_amount = 0 and amount_due is not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rental_collections' and column_name = 'status'
  ) then
    update public.rental_collections
    set payment_status = case status when 'late' then 'overdue' else status end
    where payment_status = 'outstanding' and status is not null;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rental_collections' and column_name = 'total_due'
  ) then
    alter table public.rental_collections
      add column total_due numeric(12, 2) generated always as (
        rental_amount + tnb_amount + water_amount + iwk_amount + wifi_amount + aircond_amount + other_charges
      ) stored;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'rental_collections' and column_name = 'outstanding_balance'
  ) then
    alter table public.rental_collections
      add column outstanding_balance numeric(12, 2) generated always as (
        greatest((rental_amount + tnb_amount + water_amount + iwk_amount + wifi_amount + aircond_amount + other_charges) - amount_paid, 0)
      ) stored;
  end if;
end $$;

create or replace function public.sync_rental_collection_totals()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.total_due =
    new.rental_amount + new.tnb_amount + new.water_amount + new.iwk_amount +
    new.wifi_amount + new.aircond_amount + new.other_charges;
  new.outstanding_balance = greatest(new.total_due - new.amount_paid, 0);
  return new;
end;
$$;

do $$
declare
  total_due_generation text;
  outstanding_generation text;
begin
  select is_generated into total_due_generation
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'rental_collections'
    and column_name = 'total_due';

  select is_generated into outstanding_generation
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'rental_collections'
    and column_name = 'outstanding_balance';

  drop trigger if exists sync_rental_collection_totals on public.rental_collections;

  if total_due_generation = 'NEVER' and outstanding_generation = 'NEVER' then
    create trigger sync_rental_collection_totals
    before insert or update on public.rental_collections
    for each row
    execute function public.sync_rental_collection_totals();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rental_collections_amounts_valid' and conrelid = 'public.rental_collections'::regclass) then
    alter table public.rental_collections
      add constraint rental_collections_amounts_valid
      check (
        rental_amount >= 0 and tnb_amount >= 0 and water_amount >= 0 and iwk_amount >= 0
        and wifi_amount >= 0 and aircond_amount >= 0 and other_charges >= 0 and amount_paid >= 0
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'rental_collections_payment_status_valid' and conrelid = 'public.rental_collections'::regclass) then
    alter table public.rental_collections
      add constraint rental_collections_payment_status_valid
      check (payment_status in ('paid', 'partial', 'outstanding', 'overdue'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'rental_collections_month_first_day' and conrelid = 'public.rental_collections'::regclass) then
    alter table public.rental_collections
      add constraint rental_collections_month_first_day
      check (collection_month = date_trunc('month', collection_month)::date);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'rental_collections_unique_tenancy_month' and conrelid = 'public.rental_collections'::regclass) then
    alter table public.rental_collections
      add constraint rental_collections_unique_tenancy_month
      unique (tenancy_id, collection_month);
  end if;
end $$;

create index if not exists rental_collections_tenancy_idx on public.rental_collections (tenancy_id);
create index if not exists rental_collections_month_idx on public.rental_collections (collection_month);
create index if not exists rental_collections_payment_status_idx on public.rental_collections (payment_status);
create index if not exists rental_collections_due_date_idx on public.rental_collections (due_date);

alter table public.rental_collections enable row level security;
grant select, insert, update, delete on public.rental_collections to anon, authenticated;

drop policy if exists "Founders beta read rental_collections" on public.rental_collections;
create policy "Founders beta read rental_collections"
on public.rental_collections for select to anon, authenticated using (true);

drop policy if exists "Founders beta insert rental_collections" on public.rental_collections;
create policy "Founders beta insert rental_collections"
on public.rental_collections for insert to anon, authenticated with check (true);

drop policy if exists "Founders beta update rental_collections" on public.rental_collections;
create policy "Founders beta update rental_collections"
on public.rental_collections for update to anon, authenticated using (true) with check (true);

drop policy if exists "Founders beta delete rental_collections" on public.rental_collections;
create policy "Founders beta delete rental_collections"
on public.rental_collections for delete to anon, authenticated using (true);
