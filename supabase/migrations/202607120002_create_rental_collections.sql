create table if not exists public.rental_collections (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.tenancies (id) on delete cascade,
  collection_month date not null,
  due_date date not null,
  amount_due numeric(12, 2) not null default 0 check (amount_due >= 0),
  amount_paid numeric(12, 2) not null default 0 check (amount_paid >= 0),
  outstanding_balance numeric(12, 2) generated always as (greatest(amount_due - amount_paid, 0)) stored,
  status text not null default 'outstanding' check (status in ('paid', 'partial', 'outstanding', 'late')),
  payment_history jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenancy_id, collection_month)
);

create index if not exists rental_collections_tenancy_idx on public.rental_collections (tenancy_id);
create index if not exists rental_collections_month_idx on public.rental_collections (collection_month);
create index if not exists rental_collections_status_idx on public.rental_collections (status);
create index if not exists rental_collections_due_date_idx on public.rental_collections (due_date);

drop trigger if exists set_rental_collections_updated_at on public.rental_collections;
create trigger set_rental_collections_updated_at
before update on public.rental_collections
for each row
execute function public.set_updated_at();
