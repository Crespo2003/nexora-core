-- Sprint 011: source-backed extraction evidence, review corrections, and duplicate-safe import.

alter table public.tenancy_extractions
  add column if not exists source_references jsonb not null default '{}'::jsonb,
  add column if not exists user_corrections jsonb not null default '{}'::jsonb;

alter table public.document_extractions
  add column if not exists source_references jsonb not null default '{}'::jsonb,
  add column if not exists user_corrections jsonb not null default '{}'::jsonb;

create or replace function public.sprint_011_populate_review_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.source_references := coalesce(new.extracted_json -> 'field_evidence', '{}'::jsonb);
  new.user_corrections := coalesce(new.confidence_json -> 'userCorrections', '{}'::jsonb);
  return new;
end;
$$;

revoke all on function public.sprint_011_populate_review_metadata() from public, anon, authenticated;

drop trigger if exists sprint_011_tenancy_review_metadata on public.tenancy_extractions;
create trigger sprint_011_tenancy_review_metadata
before insert or update of extracted_json, confidence_json
on public.tenancy_extractions
for each row execute function public.sprint_011_populate_review_metadata();

drop trigger if exists sprint_011_document_review_metadata on public.document_extractions;
create trigger sprint_011_document_review_metadata
before insert or update of extracted_json, confidence_json
on public.document_extractions
for each row execute function public.sprint_011_populate_review_metadata();

create or replace function public.sprint_011_import_tenancy_legal_intelligence(
  p_workspace_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  imported jsonb;
  imported_document_hash text := nullif(p_payload -> 'document' ->> 'documentHash', '');
  corrections jsonb := coalesce(p_payload -> 'extraction' -> 'confidenceJson' -> 'userCorrections', '{}'::jsonb);
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  imported := public.sprint_009_import_tenancy_legal_intelligence(p_workspace_id, p_payload);

  if imported_document_hash is not null then
    update public.documents
    set document_hash = imported_document_hash
    where id = (imported -> 'documentCentre' ->> 'id')::uuid
      and workspace_id = p_workspace_id;
  end if;

  insert into public.activity_logs (
    workspace_id, entity_type, entity_id, activity_type, activity_json, created_by
  ) values (
    p_workspace_id,
    'tenancy',
    (imported -> 'tenancy' ->> 'id')::uuid,
    'tenancy_import_review_confirmed',
    jsonb_build_object(
      'correctionCount', jsonb_object_length(corrections),
      'correctedFields', coalesce(
        (
          select jsonb_agg(field_name order by field_name)
          from jsonb_object_keys(corrections) as fields(field_name)
        ),
        '[]'::jsonb
      )
    ),
    (select auth.uid())::text
  );

  return imported;
end;
$$;

revoke all on function public.sprint_011_import_tenancy_legal_intelligence(uuid, jsonb) from public, anon;
grant execute on function public.sprint_011_import_tenancy_legal_intelligence(uuid, jsonb) to authenticated;

update public.tenancy_extractions
set extracted_json = extracted_json,
    confidence_json = confidence_json;

update public.document_extractions
set extracted_json = extracted_json,
    confidence_json = confidence_json;
