-- Production compatibility for the active tenancy import payload.
-- The historical live schema predates the optional tenant-company field that is
-- already emitted by the existing Rental Command Centre mapper.

alter table public.tenancies
  add column if not exists tenant_company text not null default '';

notify pgrst, 'reload schema';
