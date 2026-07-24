-- Remove stale document_links rows where the referenced tenancy no longer exists.
-- These are orphaned rows produced by tenancy deletions before this fix was deployed.
-- document_links.entity_id has no FK to tenancies, so rows are not auto-deleted on tenancy removal.
-- Safe to run multiple times — only truly stale rows are deleted.

delete from public.document_links dl
where dl.entity_type = 'tenancy'
  and not exists (
    select 1
    from public.tenancies t
    where t.id = dl.entity_id
  );
