-- Repair stale documents.linked_status values.
-- A document is truly linked only if at least one of:
--   (a) tenancy_documents has a row for its storage_path with tenancy_id IS NOT NULL (legacy link path)
--   (b) document_links has a row for its id pointing to a tenancy that still exists (new import path)
-- Run once on migration to fix rows made stale by tenancy deletions before this migration.

update public.documents
set linked_status = 'unlinked'
where linked_status = 'linked'
  and not exists (
    select 1
    from public.tenancy_documents td
    where td.storage_path = public.documents.storage_path
      and td.tenancy_id is not null
  )
  and not exists (
    select 1
    from public.document_links dl
    inner join public.tenancies t on t.id = dl.entity_id
    where dl.document_id = public.documents.id
      and dl.entity_type = 'tenancy'
  );
