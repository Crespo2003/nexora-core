-- Sprint 003 Smart Collection Centre and Utility Account Memory
-- Idempotent extension of Sprint 001/002 rental, collection and document foundations.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.tenancies
  add column if not exists rental_due_day integer not null default 1,
  add column if not exists grace_period_days integer not null default 0,
  add column if not exists late_interest_rule text not null default '',
  add column if not exists reminder_schedule jsonb not null default '[]'::jsonb,
  add column if not exists collection_start_month date,
  add column if not exists collection_end_month date,
  add column if not exists auto_generate_collections boolean not null default false,
  add column if not exists preferred_language text not null default 'en',
  add column if not exists assigned_agent text not null default '';

alter table public.rental_collections
  add column if not exists late_charges numeric(12, 2) not null default 0,
  add column if not exists adjustments numeric(12, 2) not null default 0,
  add column if not exists status_history jsonb not null default '[]'::jsonb,
  add column if not exists audit_json jsonb not null default '[]'::jsonb;

do $$
declare
  total_generation text;
  outstanding_generation text;
begin
  select is_generated into total_generation
  from information_schema.columns
  where table_schema = 'public' and table_name = 'rental_collections' and column_name = 'total_due';

  select is_generated into outstanding_generation
  from information_schema.columns
  where table_schema = 'public' and table_name = 'rental_collections' and column_name = 'outstanding_balance';

  if total_generation = 'NEVER' or outstanding_generation = 'NEVER' then
    create or replace function public.sync_sprint_003_collection_totals()
    returns trigger
    language plpgsql
    security invoker
    as $fn$
    begin
      new.total_due = greatest(new.rental_amount + new.tnb_amount + new.water_amount + new.iwk_amount + new.wifi_amount + new.aircond_amount + new.other_charges + new.late_charges + new.adjustments, 0);
      new.outstanding_balance = greatest(new.total_due - new.amount_paid, 0);
      return new;
    end;
    $fn$;

    drop trigger if exists sync_sprint_003_collection_totals on public.rental_collections;
    create trigger sync_sprint_003_collection_totals
    before insert or update on public.rental_collections
    for each row execute function public.sync_sprint_003_collection_totals();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenancies_collection_schedule_valid' and conrelid = 'public.tenancies'::regclass) then
    alter table public.tenancies add constraint tenancies_collection_schedule_valid
    check (
      rental_due_day between 1 and 31
      and grace_period_days >= 0
      and preferred_language in ('en', 'zh', 'bilingual')
      and (collection_start_month is null or collection_start_month = date_trunc('month', collection_start_month)::date)
      and (collection_end_month is null or collection_end_month = date_trunc('month', collection_end_month)::date)
      and (collection_start_month is null or collection_end_month is null or collection_end_month >= collection_start_month)
    );
  end if;

  if exists (select 1 from pg_constraint where conname = 'rental_collections_amounts_valid' and conrelid = 'public.rental_collections'::regclass) then
    alter table public.rental_collections drop constraint rental_collections_amounts_valid;
  end if;

  alter table public.rental_collections add constraint rental_collections_amounts_valid
  check (
    rental_amount >= 0 and tnb_amount >= 0 and water_amount >= 0 and iwk_amount >= 0
    and wifi_amount >= 0 and aircond_amount >= 0 and other_charges >= 0
    and late_charges >= 0 and amount_paid >= 0
  );

  if exists (select 1 from pg_constraint where conname = 'rental_collections_payment_status_valid' and conrelid = 'public.rental_collections'::regclass) then
    alter table public.rental_collections drop constraint rental_collections_payment_status_valid;
  end if;

  alter table public.rental_collections add constraint rental_collections_payment_status_valid
  check (payment_status in ('pending', 'due', 'paid', 'partial', 'outstanding', 'overdue', 'waived', 'disputed'));
end $$;

create table if not exists public.utility_accounts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  landlord text not null default '',
  provider text not null check (provider in ('tnb', 'water', 'iwk', 'wifi', 'aircond', 'other')),
  account_number text not null,
  account_number_masked text not null,
  meter_number text not null default '',
  registered_name text not null default '',
  billing_address text not null default '',
  portal_name text not null default '',
  portal_reference text not null default '',
  payment_method_notes text not null default '',
  recurring_fee numeric(12, 2) not null default 0,
  deposit_amount numeric(12, 2) not null default 0,
  account_status text not null default 'active' check (account_status in ('active', 'inactive', 'changed', 'closed')),
  valid_from date,
  valid_to date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.utility_account_history (
  id uuid primary key default gen_random_uuid(),
  utility_account_id uuid references public.utility_accounts(id) on delete cascade,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  provider text not null,
  previous_account_number text not null,
  previous_account_number_masked text not null,
  changed_to_account_number text not null default '',
  changed_at timestamptz not null default now(),
  change_reason text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.utility_bills (
  id uuid primary key default gen_random_uuid(),
  utility_account_id uuid references public.utility_accounts(id) on delete set null,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  property_id uuid,
  rental_collection_id uuid references public.rental_collections(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  provider text not null check (provider in ('tnb', 'water', 'iwk', 'wifi', 'aircond', 'other')),
  bill_number text not null default '',
  bill_date date,
  billing_period_start date,
  billing_period_end date,
  due_date date,
  previous_balance numeric(12, 2),
  current_charges numeric(12, 2),
  adjustments numeric(12, 2),
  tax_amount numeric(12, 2),
  total_amount_due numeric(12, 2),
  extracted_json jsonb not null default '{}'::jsonb,
  confidence_json jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending_review' check (review_status in ('uploaded', 'pending_review', 'confirmed', 'rejected', 'duplicate')),
  payment_status text not null default 'not_detected',
  source_filename text not null default '',
  raw_extracted_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_payments (
  id uuid primary key default gen_random_uuid(),
  rental_collection_id uuid not null references public.rental_collections(id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  payment_date date not null,
  payment_method text not null check (payment_method in ('bank_transfer', 'cash', 'duitnow', 'touch_n_go', 'cheque', 'online_banking', 'other')),
  payment_reference text not null default '',
  receipt_number text not null default '',
  notes text not null default '',
  recorded_by text not null default '',
  transaction_type text not null default 'payment' check (transaction_type in ('payment', 'adjustment', 'waiver', 'refund', 'reversal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_reminders (
  id uuid primary key default gen_random_uuid(),
  rental_collection_id uuid not null references public.rental_collections(id) on delete cascade,
  reminder_type text not null,
  language text not null check (language in ('en', 'zh', 'bilingual')),
  message_text text not null,
  sent_status text not null default 'draft' check (sent_status in ('draft', 'copied', 'sent', 'cancelled')),
  sent_at timestamptz,
  channel text not null default 'whatsapp',
  created_at timestamptz not null default now()
);

create table if not exists public.collection_followups (
  id uuid primary key default gen_random_uuid(),
  rental_collection_id uuid not null references public.rental_collections(id) on delete cascade,
  recommended_action text not null default '',
  followup_status text not null default 'open' check (followup_status in ('open', 'contacted', 'snoozed', 'promise_to_pay', 'escalated', 'closed')),
  snoozed_until date,
  promise_to_pay_date date,
  last_contacted_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_adjustments (
  id uuid primary key default gen_random_uuid(),
  rental_collection_id uuid not null references public.rental_collections(id) on delete cascade,
  adjustment_type text not null check (adjustment_type in ('charge', 'discount', 'waiver', 'correction')),
  amount numeric(12, 2) not null check (amount >= 0),
  reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  activity_type text not null,
  activity_json jsonb not null default '{}'::jsonb,
  created_by text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists utility_accounts_provider_account_unique on public.utility_accounts (provider, account_number);
create unique index if not exists utility_bills_provider_bill_unique on public.utility_bills (provider, bill_number) where bill_number <> '';
create unique index if not exists utility_bills_document_unique on public.utility_bills (document_id) where document_id is not null;
create index if not exists utility_accounts_tenancy_idx on public.utility_accounts (tenancy_id);
create index if not exists utility_accounts_account_search_idx on public.utility_accounts using gin (to_tsvector('simple', coalesce(account_number, '') || ' ' || coalesce(account_number_masked, '')));
create index if not exists utility_bills_collection_idx on public.utility_bills (rental_collection_id);
create index if not exists utility_bills_review_idx on public.utility_bills (review_status);
create index if not exists collection_payments_collection_idx on public.collection_payments (rental_collection_id);
create index if not exists collection_reminders_collection_idx on public.collection_reminders (rental_collection_id);
create index if not exists collection_followups_collection_idx on public.collection_followups (rental_collection_id);
create index if not exists activity_logs_entity_idx on public.activity_logs (entity_type, entity_id);
create index if not exists activity_logs_created_at_idx on public.activity_logs (created_at desc);

drop trigger if exists utility_accounts_set_updated_at on public.utility_accounts;
create trigger utility_accounts_set_updated_at before update on public.utility_accounts for each row execute function public.set_updated_at();
drop trigger if exists utility_bills_set_updated_at on public.utility_bills;
create trigger utility_bills_set_updated_at before update on public.utility_bills for each row execute function public.set_updated_at();
drop trigger if exists collection_payments_set_updated_at on public.collection_payments;
create trigger collection_payments_set_updated_at before update on public.collection_payments for each row execute function public.set_updated_at();
drop trigger if exists collection_followups_set_updated_at on public.collection_followups;
create trigger collection_followups_set_updated_at before update on public.collection_followups for each row execute function public.set_updated_at();
drop trigger if exists collection_adjustments_set_updated_at on public.collection_adjustments;
create trigger collection_adjustments_set_updated_at before update on public.collection_adjustments for each row execute function public.set_updated_at();

alter table public.utility_accounts enable row level security;
alter table public.utility_account_history enable row level security;
alter table public.utility_bills enable row level security;
alter table public.collection_payments enable row level security;
alter table public.collection_reminders enable row level security;
alter table public.collection_followups enable row level security;
alter table public.collection_adjustments enable row level security;
alter table public.activity_logs enable row level security;

grant select, insert, update, delete on public.utility_accounts to anon, authenticated;
grant select, insert, update, delete on public.utility_account_history to anon, authenticated;
grant select, insert, update, delete on public.utility_bills to anon, authenticated;
grant select, insert, update, delete on public.collection_payments to anon, authenticated;
grant select, insert, update, delete on public.collection_reminders to anon, authenticated;
grant select, insert, update, delete on public.collection_followups to anon, authenticated;
grant select, insert, update, delete on public.collection_adjustments to anon, authenticated;
grant select, insert, update, delete on public.activity_logs to anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'utility_accounts',
    'utility_account_history',
    'utility_bills',
    'collection_payments',
    'collection_reminders',
    'collection_followups',
    'collection_adjustments',
    'activity_logs'
  ]
  loop
    execute format('drop policy if exists "Founders beta read %1$s" on public.%1$I', table_name);
    execute format('create policy "Founders beta read %1$s" on public.%1$I for select to anon, authenticated using (true)', table_name);
    execute format('drop policy if exists "Founders beta insert %1$s" on public.%1$I', table_name);
    execute format('create policy "Founders beta insert %1$s" on public.%1$I for insert to anon, authenticated with check (true)', table_name);
    execute format('drop policy if exists "Founders beta update %1$s" on public.%1$I', table_name);
    execute format('create policy "Founders beta update %1$s" on public.%1$I for update to anon, authenticated using (true) with check (true)', table_name);
    execute format('drop policy if exists "Founders beta delete %1$s" on public.%1$I', table_name);
    execute format('create policy "Founders beta delete %1$s" on public.%1$I for delete to anon, authenticated using (true)', table_name);
  end loop;
end $$;
