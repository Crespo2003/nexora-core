-- Keep the upload RPC on the caller's database privileges and RLS policies.
-- Agents are already authorised by the API route to create a tenancy; the two
-- existing collection policies must therefore allow the matching, scoped write.

drop policy if exists "rental_collections workspace insert" on public.rental_collections;
create policy "rental_collections workspace insert"
  on public.rental_collections
  for insert
  to authenticated
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent', 'finance']));

drop policy if exists "collection_payments workspace insert" on public.collection_payments;
create policy "collection_payments workspace insert"
  on public.collection_payments
  for insert
  to authenticated
  with check (public.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent', 'finance']));

alter function public.upload_end_to_end_import_tenancy(uuid, jsonb) security invoker;
alter function public.upload_end_to_end_import_tenancy(uuid, jsonb) set search_path = '';
alter function public.sprint_015_import_tenancy_legal_intelligence(uuid, jsonb) security invoker;
alter function public.sprint_015_import_tenancy_legal_intelligence(uuid, jsonb) set search_path = '';

create index if not exists tenancy_legal_analyses_document_id_idx
  on public.tenancy_legal_analyses (document_id);
create index if not exists tenancy_legal_analyses_tenancy_id_idx
  on public.tenancy_legal_analyses (tenancy_id);
create index if not exists tenancy_legal_clauses_document_id_idx
  on public.tenancy_legal_clauses (document_id);
create index if not exists tenancy_legal_risks_document_id_idx
  on public.tenancy_legal_risks (document_id);

notify pgrst, 'reload schema';
