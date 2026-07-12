alter table public.tenancies enable row level security;
alter table public.rental_collections enable row level security;

grant select, insert, update, delete on public.tenancies to anon, authenticated;
grant select, insert, update, delete on public.rental_collections to anon, authenticated;

alter table public.tenancies
  add constraint tenancies_required_text
  check (
    length(btrim(tenant)) > 0
    and length(btrim(landlord)) > 0
    and length(btrim(property)) > 0
  );

alter table public.rental_collections
  add constraint rental_collections_amount_paid_lte_due
  check (amount_paid <= amount_due),
  add constraint rental_collections_month_starts_on_first
  check (collection_month = date_trunc('month', collection_month)::date),
  add constraint rental_collections_payment_history_array
  check (jsonb_typeof(payment_history) = 'array');

drop policy if exists "Rental command centre read tenancies" on public.tenancies;
create policy "Rental command centre read tenancies"
on public.tenancies
for select
to anon, authenticated
using (true);

drop policy if exists "Rental command centre insert tenancies" on public.tenancies;
create policy "Rental command centre insert tenancies"
on public.tenancies
for insert
to anon, authenticated
with check (true);

drop policy if exists "Rental command centre update tenancies" on public.tenancies;
create policy "Rental command centre update tenancies"
on public.tenancies
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Rental command centre delete tenancies" on public.tenancies;
create policy "Rental command centre delete tenancies"
on public.tenancies
for delete
to anon, authenticated
using (true);

drop policy if exists "Rental command centre read collections" on public.rental_collections;
create policy "Rental command centre read collections"
on public.rental_collections
for select
to anon, authenticated
using (true);

drop policy if exists "Rental command centre insert collections" on public.rental_collections;
create policy "Rental command centre insert collections"
on public.rental_collections
for insert
to anon, authenticated
with check (true);

drop policy if exists "Rental command centre update collections" on public.rental_collections;
create policy "Rental command centre update collections"
on public.rental_collections
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Rental command centre delete collections" on public.rental_collections;
create policy "Rental command centre delete collections"
on public.rental_collections
for delete
to anon, authenticated
using (true);
