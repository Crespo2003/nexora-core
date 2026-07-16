-- Sprint 010: preserve structured legal analysis alongside the raw AI extraction.

alter table public.tenancy_extractions
  add column if not exists risk_analysis jsonb not null default '[]'::jsonb,
  add column if not exists field_confidence jsonb not null default '{}'::jsonb,
  add column if not exists ai_model text not null default '',
  add column if not exists extraction_engine text not null default 'deterministic';

alter table public.document_extractions
  add column if not exists risk_analysis jsonb not null default '[]'::jsonb,
  add column if not exists field_confidence jsonb not null default '{}'::jsonb,
  add column if not exists ai_model text not null default '',
  add column if not exists extraction_engine text not null default 'deterministic';

create or replace function public.sprint_010_populate_legal_intelligence_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.risk_analysis := coalesce(new.extracted_json -> 'risks', '[]'::jsonb);
  new.field_confidence := coalesce(new.extracted_json -> 'field_confidence', '{}'::jsonb);
  new.ai_model := coalesce(
    nullif(new.extracted_json ->> 'model', ''),
    nullif(new.confidence_json -> 'document' ->> 'model', ''),
    ''
  );
  new.extraction_engine := case
    when coalesce(new.confidence_json ->> 'advancedAiConfigured', 'false')::boolean then 'openai'
    else 'deterministic'
  end;
  return new;
end;
$$;

revoke all on function public.sprint_010_populate_legal_intelligence_columns() from public, anon, authenticated;

drop trigger if exists sprint_010_tenancy_extraction_metadata on public.tenancy_extractions;
create trigger sprint_010_tenancy_extraction_metadata
before insert or update of extracted_json, confidence_json
on public.tenancy_extractions
for each row execute function public.sprint_010_populate_legal_intelligence_columns();

drop trigger if exists sprint_010_document_extraction_metadata on public.document_extractions;
create trigger sprint_010_document_extraction_metadata
before insert or update of extracted_json, confidence_json
on public.document_extractions
for each row execute function public.sprint_010_populate_legal_intelligence_columns();

update public.tenancy_extractions
set extracted_json = extracted_json,
    confidence_json = confidence_json;

update public.document_extractions
set extracted_json = extracted_json,
    confidence_json = confidence_json;
