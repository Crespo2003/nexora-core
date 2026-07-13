-- Sprint 004 final advisor hardening.

create index if not exists collection_adjustments_collection_id_idx
  on public.collection_adjustments (rental_collection_id);

create index if not exists utility_account_history_tenancy_id_idx
  on public.utility_account_history (tenancy_id);

create index if not exists utility_account_history_account_id_idx
  on public.utility_account_history (utility_account_id);

create index if not exists utility_bills_tenancy_id_idx
  on public.utility_bills (tenancy_id);

create index if not exists utility_bills_account_id_idx
  on public.utility_bills (utility_account_id);

revoke execute on function public.bootstrap_first_workspace(text, text, text, text) from public, anon;
grant execute on function public.bootstrap_first_workspace(text, text, text, text) to authenticated;

revoke execute on function public.sprint_004_system_check(uuid) from public, anon;
grant execute on function public.sprint_004_system_check(uuid) to authenticated;
