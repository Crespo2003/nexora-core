-- Sprint 015: workspace-isolated clause intelligence and agreement comparison.
-- This migration is intentionally additive and preserves all prior tenancy extraction records.

create table if not exists public.tenancy_legal_analyses (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  extraction_version text not null default 'sprint-015-v1',
  executive_summary text not null default '',
  provider text not null default '',
  model text not null default '',
  token_usage jsonb not null default '{}'::jsonb,
  estimated_request_cost numeric(14, 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, document_id, extraction_version)
);

create table if not exists public.tenancy_legal_clause_categories (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null,
  label text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, code)
);

create table if not exists public.tenancy_legal_clauses (
  id uuid primary key default extensions.gen_random_uuid(),
  analysis_id uuid not null references public.tenancy_legal_analyses(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  clause_id text not null,
  category text not null,
  title text not null,
  summary text not null default '',
  full_text text not null default '',
  source_page integer check (source_page is null or source_page > 0),
  source_excerpt text not null default '',
  confidence numeric(5, 2) not null default 0 check (confidence between 0 and 100),
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  responsible_party text not null default 'unclear' check (responsible_party in ('tenant', 'landlord', 'both', 'unclear')),
  obligation text not null default '',
  trigger_text text not null default '',
  deadline text not null default '',
  financial_impact text not null default '',
  recommendation text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (analysis_id, clause_id)
);

create table if not exists public.tenancy_legal_risks (
  id uuid primary key default extensions.gen_random_uuid(),
  analysis_id uuid not null references public.tenancy_legal_analyses(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  risk_id text not null,
  rule_id text not null,
  severity text not null check (severity in ('low', 'medium', 'high')),
  category text not null,
  title text not null,
  reason text not null,
  recommendation text not null,
  source_page integer check (source_page is null or source_page > 0),
  source_excerpt text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (analysis_id, rule_id)
);

create table if not exists public.tenancy_agreement_comparisons (
  id uuid primary key default extensions.gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_a_id uuid not null references public.documents(id) on delete cascade,
  document_b_id uuid not null references public.documents(id) on delete cascade,
  comparison_version text not null default 'sprint-015-v1',
  summary text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (document_a_id <> document_b_id),
  unique (workspace_id, document_a_id, document_b_id, comparison_version)
);

create table if not exists public.tenancy_agreement_comparison_findings (
  id uuid primary key default extensions.gen_random_uuid(),
  comparison_id uuid not null references public.tenancy_agreement_comparisons(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  finding_id text not null,
  finding_kind text not null check (finding_kind in ('field', 'added_clause', 'removed_clause', 'modified_clause', 'financial', 'date', 'risk')),
  category text not null,
  title text not null,
  before_value text not null default '',
  after_value text not null default '',
  source_page_a integer check (source_page_a is null or source_page_a > 0),
  source_excerpt_a text not null default '',
  source_page_b integer check (source_page_b is null or source_page_b > 0),
  source_excerpt_b text not null default '',
  materiality text not null check (materiality in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  unique (comparison_id, finding_id)
);

create index if not exists tenancy_legal_analyses_workspace_document_idx on public.tenancy_legal_analyses (workspace_id, document_id);
create index if not exists tenancy_legal_clauses_workspace_document_category_idx on public.tenancy_legal_clauses (workspace_id, document_id, category);
create index if not exists tenancy_legal_risks_workspace_document_severity_idx on public.tenancy_legal_risks (workspace_id, document_id, severity);
create index if not exists tenancy_agreement_comparisons_workspace_created_idx on public.tenancy_agreement_comparisons (workspace_id, created_at desc);

alter table public.tenancy_legal_analyses enable row level security;
alter table public.tenancy_legal_clause_categories enable row level security;
alter table public.tenancy_legal_clauses enable row level security;
alter table public.tenancy_legal_risks enable row level security;
alter table public.tenancy_agreement_comparisons enable row level security;
alter table public.tenancy_agreement_comparison_findings enable row level security;

grant select, insert, update, delete on public.tenancy_legal_analyses to authenticated;
grant select, insert, update, delete on public.tenancy_legal_clause_categories to authenticated;
grant select, insert, update, delete on public.tenancy_legal_clauses to authenticated;
grant select, insert, update, delete on public.tenancy_legal_risks to authenticated;
grant select, insert, update, delete on public.tenancy_agreement_comparisons to authenticated;
grant select, insert, update, delete on public.tenancy_agreement_comparison_findings to authenticated;

create policy "legal analyses workspace read" on public.tenancy_legal_analyses for select to authenticated using (private.is_workspace_member(workspace_id));
create policy "legal analyses workspace write" on public.tenancy_legal_analyses for all to authenticated using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent'])) with check (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent']));
create policy "legal categories workspace read" on public.tenancy_legal_clause_categories for select to authenticated using (private.is_workspace_member(workspace_id));
create policy "legal categories workspace write" on public.tenancy_legal_clause_categories for all to authenticated using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent'])) with check (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent']));
create policy "legal clauses workspace read" on public.tenancy_legal_clauses for select to authenticated using (private.is_workspace_member(workspace_id));
create policy "legal clauses workspace write" on public.tenancy_legal_clauses for all to authenticated using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent'])) with check (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent']));
create policy "legal risks workspace read" on public.tenancy_legal_risks for select to authenticated using (private.is_workspace_member(workspace_id));
create policy "legal risks workspace write" on public.tenancy_legal_risks for all to authenticated using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent'])) with check (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent']));
create policy "legal comparisons workspace read" on public.tenancy_agreement_comparisons for select to authenticated using (private.is_workspace_member(workspace_id));
create policy "legal comparisons workspace write" on public.tenancy_agreement_comparisons for all to authenticated using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent'])) with check (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent']));
create policy "legal comparison findings workspace read" on public.tenancy_agreement_comparison_findings for select to authenticated using (private.is_workspace_member(workspace_id));
create policy "legal comparison findings workspace write" on public.tenancy_agreement_comparison_findings for all to authenticated using (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent'])) with check (private.has_workspace_role(workspace_id, array['owner', 'admin', 'manager', 'agent']));

create or replace function public.sprint_015_import_tenancy_legal_intelligence(
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
  extraction_payload jsonb := coalesce(p_payload -> 'extraction', '{}'::jsonb);
  extracted_json jsonb := coalesce(extraction_payload -> 'extractedJson', '{}'::jsonb);
  intelligence jsonb := coalesce(extracted_json -> 'legal_intelligence', '{}'::jsonb);
  analysis_row public.tenancy_legal_analyses;
  clause_item jsonb;
  risk_item jsonb;
  document_id uuid;
  tenancy_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not public.has_workspace_role(p_workspace_id, array['owner', 'admin', 'manager', 'agent']) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;

  imported := public.sprint_011_import_tenancy_legal_intelligence(p_workspace_id, p_payload);
  document_id := (imported -> 'documentCentre' ->> 'id')::uuid;
  tenancy_id := (imported -> 'tenancy' ->> 'id')::uuid;

  insert into public.tenancy_legal_analyses (
    workspace_id, document_id, tenancy_id, extraction_version, executive_summary,
    provider, model, token_usage, estimated_request_cost
  ) values (
    p_workspace_id, document_id, tenancy_id, coalesce(nullif(intelligence ->> 'version', ''), 'sprint-015-v1'),
    coalesce(nullif(intelligence ->> 'executive_summary', ''), extraction_payload ->> 'aiSummary', ''),
    coalesce(extraction_payload -> 'confidenceJson' ->> 'provider', ''),
    coalesce(extraction_payload -> 'confidenceJson' ->> 'model', extraction_payload ->> 'model', ''),
    coalesce(extraction_payload -> 'confidenceJson' -> 'tokenUsage', '{}'::jsonb),
    nullif(extraction_payload -> 'confidenceJson' ->> 'estimatedRequestCost', '')::numeric
  ) on conflict (workspace_id, document_id, extraction_version) do update set
    tenancy_id = excluded.tenancy_id,
    executive_summary = excluded.executive_summary,
    provider = excluded.provider,
    model = excluded.model,
    token_usage = excluded.token_usage,
    estimated_request_cost = excluded.estimated_request_cost,
    updated_at = now()
  returning * into analysis_row;

  for clause_item in select value from jsonb_array_elements(coalesce(intelligence -> 'clauses', extracted_json -> 'clauses', '[]'::jsonb)) loop
    insert into public.tenancy_legal_clause_categories (workspace_id, code, label)
    values (p_workspace_id, coalesce(clause_item ->> 'category', 'Special conditions'), coalesce(clause_item ->> 'category', 'Special conditions'))
    on conflict (workspace_id, code) do nothing;

    insert into public.tenancy_legal_clauses (
      analysis_id, workspace_id, document_id, clause_id, category, title, summary, full_text,
      source_page, source_excerpt, confidence, risk_level, responsible_party, obligation,
      trigger_text, deadline, financial_impact, recommendation
    ) values (
      analysis_row.id, p_workspace_id, document_id, coalesce(nullif(clause_item ->> 'id', ''), md5(clause_item::text)),
      coalesce(clause_item ->> 'category', 'Special conditions'), coalesce(clause_item ->> 'title', 'Legal clause'),
      coalesce(clause_item ->> 'summary', ''), coalesce(clause_item ->> 'full_text', ''),
      nullif(clause_item ->> 'source_page', '')::integer, coalesce(clause_item ->> 'source_excerpt', ''),
      greatest(0, least(100, coalesce((clause_item ->> 'confidence')::numeric, 0))),
      case when clause_item ->> 'risk_level' in ('low', 'medium', 'high') then clause_item ->> 'risk_level' else 'low' end,
      case when clause_item ->> 'responsible_party' in ('tenant', 'landlord', 'both', 'unclear') then clause_item ->> 'responsible_party' else 'unclear' end,
      coalesce(clause_item ->> 'obligation', ''), coalesce(clause_item ->> 'trigger', ''), coalesce(clause_item ->> 'deadline', ''),
      coalesce(clause_item ->> 'financial_impact', ''), coalesce(clause_item ->> 'recommendation', '')
    ) on conflict (analysis_id, clause_id) do update set
      category = excluded.category, title = excluded.title, summary = excluded.summary, full_text = excluded.full_text,
      source_page = excluded.source_page, source_excerpt = excluded.source_excerpt, confidence = excluded.confidence,
      risk_level = excluded.risk_level, responsible_party = excluded.responsible_party, obligation = excluded.obligation,
      trigger_text = excluded.trigger_text, deadline = excluded.deadline, financial_impact = excluded.financial_impact,
      recommendation = excluded.recommendation, updated_at = now();
  end loop;

  for risk_item in select value from jsonb_array_elements(coalesce(intelligence -> 'risks', '[]'::jsonb)) loop
    insert into public.tenancy_legal_risks (
      analysis_id, workspace_id, document_id, risk_id, rule_id, severity, category, title,
      reason, recommendation, source_page, source_excerpt
    ) values (
      analysis_row.id, p_workspace_id, document_id, coalesce(nullif(risk_item ->> 'id', ''), md5(risk_item::text)),
      coalesce(nullif(risk_item ->> 'rule_id', ''), md5(risk_item::text)),
      case when risk_item ->> 'severity' in ('low', 'medium', 'high') then risk_item ->> 'severity' else 'medium' end,
      coalesce(risk_item ->> 'category', 'Legal review'), coalesce(risk_item ->> 'title', 'Legal review required'),
      coalesce(risk_item ->> 'reason', ''), coalesce(risk_item ->> 'recommendation', ''),
      nullif(risk_item ->> 'source_page', '')::integer, coalesce(risk_item ->> 'source_excerpt', '')
    ) on conflict (analysis_id, rule_id) do update set
      severity = excluded.severity, category = excluded.category, title = excluded.title, reason = excluded.reason,
      recommendation = excluded.recommendation, source_page = excluded.source_page,
      source_excerpt = excluded.source_excerpt, updated_at = now();
  end loop;

  insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json, created_by)
  values (
    p_workspace_id, 'document', document_id, 'legal_intelligence_persisted',
    jsonb_build_object('analysisId', analysis_row.id, 'version', analysis_row.extraction_version, 'clauseCount', jsonb_array_length(coalesce(intelligence -> 'clauses', '[]'::jsonb)), 'riskCount', jsonb_array_length(coalesce(intelligence -> 'risks', '[]'::jsonb))),
    (select auth.uid())::text
  );

  return imported || jsonb_build_object('legalIntelligence', jsonb_build_object('analysisId', analysis_row.id, 'cached', false));
end;
$$;

revoke all on function public.sprint_015_import_tenancy_legal_intelligence(uuid, jsonb) from public, anon;
grant execute on function public.sprint_015_import_tenancy_legal_intelligence(uuid, jsonb) to authenticated;

create or replace function public.sprint_015_save_tenancy_comparison(
  p_workspace_id uuid,
  p_document_a_id uuid,
  p_document_b_id uuid,
  p_comparison jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  comparison_row public.tenancy_agreement_comparisons;
  finding jsonb;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not public.has_workspace_role(p_workspace_id, array['owner', 'admin', 'manager', 'agent']) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;
  if p_document_a_id = p_document_b_id then
    raise exception using errcode = '22023', message = 'different_documents_required';
  end if;
  if not exists (select 1 from public.tenancy_legal_analyses where workspace_id = p_workspace_id and document_id = p_document_a_id)
     or not exists (select 1 from public.tenancy_legal_analyses where workspace_id = p_workspace_id and document_id = p_document_b_id) then
    raise exception using errcode = 'P0002', message = 'legal_analysis_not_found_in_workspace';
  end if;

  insert into public.tenancy_agreement_comparisons (workspace_id, document_a_id, document_b_id, summary, created_by)
  values (p_workspace_id, p_document_a_id, p_document_b_id, coalesce(p_comparison ->> 'summary', ''), (select auth.uid()))
  on conflict (workspace_id, document_a_id, document_b_id, comparison_version) do update set
    summary = excluded.summary, updated_at = now()
  returning * into comparison_row;

  delete from public.tenancy_agreement_comparison_findings
  where comparison_id = comparison_row.id and workspace_id = p_workspace_id;

  for finding in select value from jsonb_array_elements(
    coalesce(p_comparison -> 'changed_fields', '[]'::jsonb) || coalesce(p_comparison -> 'added_clauses', '[]'::jsonb) ||
    coalesce(p_comparison -> 'removed_clauses', '[]'::jsonb) || coalesce(p_comparison -> 'modified_clauses', '[]'::jsonb) ||
    coalesce(p_comparison -> 'financial_changes', '[]'::jsonb) || coalesce(p_comparison -> 'date_changes', '[]'::jsonb) ||
    coalesce(p_comparison -> 'risk_changes', '[]'::jsonb)
  ) loop
    insert into public.tenancy_agreement_comparison_findings (
      comparison_id, workspace_id, finding_id, finding_kind, category, title, before_value, after_value,
      source_page_a, source_excerpt_a, source_page_b, source_excerpt_b, materiality
    ) values (
      comparison_row.id, p_workspace_id, coalesce(nullif(finding ->> 'id', ''), md5(finding::text)),
      case when finding ->> 'kind' in ('field', 'added_clause', 'removed_clause', 'modified_clause', 'financial', 'date', 'risk') then finding ->> 'kind' else 'field' end,
      coalesce(finding ->> 'category', ''), coalesce(finding ->> 'title', ''), coalesce(finding ->> 'before', ''), coalesce(finding ->> 'after', ''),
      nullif(finding -> 'source_reference_a' ->> 'source_page', '')::integer, coalesce(finding -> 'source_reference_a' ->> 'source_excerpt', ''),
      nullif(finding -> 'source_reference_b' ->> 'source_page', '')::integer, coalesce(finding -> 'source_reference_b' ->> 'source_excerpt', ''),
      case when finding ->> 'materiality' in ('low', 'medium', 'high') then finding ->> 'materiality' else 'low' end
    );
  end loop;

  insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json, created_by)
  values (p_workspace_id, 'tenancy_comparison', comparison_row.id, 'tenancy_agreements_compared', jsonb_build_object('documentAId', p_document_a_id, 'documentBId', p_document_b_id), (select auth.uid())::text);

  return jsonb_build_object('comparisonId', comparison_row.id, 'summary', comparison_row.summary, 'idempotentReplay', comparison_row.updated_at > comparison_row.created_at);
end;
$$;

revoke all on function public.sprint_015_save_tenancy_comparison(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.sprint_015_save_tenancy_comparison(uuid, uuid, uuid, jsonb) to authenticated;
