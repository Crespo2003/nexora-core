-- Remove inherited legacy privileges that bypass row-level write policies.

revoke all on public.properties from authenticated;
revoke all on public.listing_memory from authenticated;

grant select, insert, update, delete on public.properties to authenticated;
grant select, insert, update, delete on public.listing_memory to authenticated;
