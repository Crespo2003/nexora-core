-- Sprint 004 corrective hardening.
-- Removes permissive Sprint 001/002 policies whose legacy names were not covered by the initial cleanup.

drop policy if exists "documents beta read" on public.documents;
drop policy if exists "documents beta insert" on public.documents;
drop policy if exists "documents beta update" on public.documents;
drop policy if exists "documents beta delete" on public.documents;

drop policy if exists "document extractions beta read" on public.document_extractions;
drop policy if exists "document extractions beta insert" on public.document_extractions;
drop policy if exists "document extractions beta update" on public.document_extractions;
drop policy if exists "document extractions beta delete" on public.document_extractions;

drop policy if exists "document links beta read" on public.document_links;
drop policy if exists "document links beta insert" on public.document_links;
drop policy if exists "document links beta update" on public.document_links;
drop policy if exists "document links beta delete" on public.document_links;

drop policy if exists "import jobs beta read" on public.import_jobs;
drop policy if exists "import jobs beta insert" on public.import_jobs;
drop policy if exists "import jobs beta update" on public.import_jobs;
drop policy if exists "import jobs beta delete" on public.import_jobs;

drop policy if exists "document activity beta read" on public.document_activity;
drop policy if exists "document activity beta insert" on public.document_activity;
drop policy if exists "document activity beta update" on public.document_activity;
drop policy if exists "document activity beta delete" on public.document_activity;

drop policy if exists "Founders beta upload tenancy documents" on storage.objects;
drop policy if exists "Founders beta read tenancy documents" on storage.objects;
drop policy if exists "Founders beta update tenancy documents" on storage.objects;

drop policy if exists "activity_logs workspace delete" on public.activity_logs;
