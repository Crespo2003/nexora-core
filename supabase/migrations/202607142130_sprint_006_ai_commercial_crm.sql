-- Sprint 006 AI Commercial CRM and requirement matching.
-- Additive only. Existing residential tables and workflows are unchanged.

create table if not exists public.commercial_companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  legal_name text not null,
  registration_number text not null default '',
  country text not null default 'Malaysia',
  headquarters text not null default '',
  industry text not null default '',
  business_category text not null default 'other',
  website text not null default '',
  company_status text not null default 'active',
  expansion_status text not null default '',
  target_countries text[] not null default '{}',
  target_cities text[] not null default '{}',
  notes text not null default '',
  source text not null default '',
  tags text[] not null default '{}',
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  next_follow_up date,
  last_activity_at timestamptz,
  status text not null default 'active',
  metadata jsonb not null default '{}',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_companies_category_valid check (business_category in ('f&b','restaurant','cafe','retail','fashion','beauty','wellness','education','medical','automotive','showroom','office','logistics','warehouse','hotel','entertainment','supermarket','convenience_store','other'))
);

create table if not exists public.commercial_brands (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  company_id uuid not null references public.commercial_companies(id) on delete cascade,
  brand_name text not null, business_category text not null default 'other', expansion_status text not null default '',
  target_countries text[] not null default '{}', target_cities text[] not null default '{}', website text not null default '',
  notes text not null default '', assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(), status text not null default 'active',
  metadata jsonb not null default '{}', deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, company_id, brand_name)
);

create table if not exists public.commercial_contacts (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  company_id uuid not null references public.commercial_companies(id) on delete cascade,
  brand_id uuid references public.commercial_brands(id) on delete set null,
  full_name text not null, job_title text not null default '', department text not null default '', phone text not null default '',
  whatsapp_number text not null default '', email text not null default '', preferred_language text not null default 'en',
  nationality text not null default '', country text not null default '', decision_maker_level text not null default 'unknown',
  influence_level text not null default '', communication_preference text not null default '', last_contacted_date date,
  next_follow_up date, notes text not null default '', assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(), status text not null default 'active',
  confidentiality_level text not null default 'internal_only', metadata jsonb not null default '{}', deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint commercial_contacts_language_valid check (preferred_language in ('en','zh','ms','bilingual')),
  constraint commercial_contacts_decision_level_valid check (decision_maker_level in ('final_decision_maker','key_influencer','operations','expansion_manager','franchise_manager','finance','legal','assistant','broker','unknown'))
);

create table if not exists public.commercial_requirements (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  title text not null, company_id uuid references public.commercial_companies(id) on delete set null,
  brand_id uuid references public.commercial_brands(id) on delete set null, contact_id uuid references public.commercial_contacts(id) on delete set null,
  requirement_type text not null default 'other', property_category text not null default '', transaction_type text not null default 'rent',
  preferred_locations text[] not null default '{}', excluded_locations text[] not null default '{}', target_building text not null default '',
  min_built_up numeric(14,2), max_built_up numeric(14,2), min_land_area numeric(14,2), max_land_area numeric(14,2),
  frontage_requirement numeric(12,2), ceiling_height_requirement numeric(12,2), floor_preference text not null default '',
  corner_preference boolean, ground_floor_required boolean not null default false, drive_through_required boolean not null default false,
  parking_requirement integer, loading_bay_required boolean not null default false, power_requirement text not null default '',
  three_phase_required boolean not null default false, exhaust_required boolean not null default false, grease_trap_required boolean not null default false,
  gas_required boolean not null default false, water_required boolean not null default false, signage_required boolean not null default false,
  outdoor_area_required boolean not null default false, swimming_pool_required boolean not null default false,
  kitchen_ready_required boolean not null default false, commercial_zoning_required boolean not null default true,
  licence_requirement text not null default '', halal_requirement text not null default '', target_rental numeric(14,2), max_rental numeric(14,2),
  target_purchase_price numeric(16,2), max_purchase_price numeric(16,2), preferred_tenancy_term text not null default '',
  commencement_target date, urgency text not null default 'exploratory', confidentiality_level text not null default 'internal_only',
  source text not null default '', assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(), status text not null default 'new_enquiry',
  rejection_reasons text[] not null default '{}', notes text not null default '', expiry_date date, next_follow_up date,
  metadata jsonb not null default '{}', deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint commercial_requirements_type_valid check (requirement_type in ('retail','restaurant','cafe','showroom','commercial_bungalow','office','warehouse','industrial','land','mall_lot','shoplot','hotel','mixed_use','other')),
  constraint commercial_requirements_transaction_valid check (transaction_type in ('rent','sale','either')),
  constraint commercial_requirements_urgency_valid check (urgency in ('immediate','within_30_days','within_60_days','within_90_days','exploratory')),
  constraint commercial_requirements_size_valid check (coalesce(min_built_up,0) >= 0 and coalesce(max_built_up,0) >= 0 and (min_built_up is null or max_built_up is null or min_built_up <= max_built_up)),
  constraint commercial_requirements_budget_valid check (coalesce(target_rental,0) >= 0 and coalesce(max_rental,0) >= 0 and coalesce(target_purchase_price,0) >= 0 and coalesce(max_purchase_price,0) >= 0)
);

create table if not exists public.commercial_requirement_locations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  requirement_id uuid not null references public.commercial_requirements(id) on delete cascade, location_name text not null,
  location_type text not null default 'area', preference text not null default 'preferred', priority integer not null default 1,
  assigned_user_id uuid references auth.users(id) on delete set null, created_by uuid references auth.users(id) on delete set null default auth.uid(),
  status text not null default 'active', metadata jsonb not null default '{}', deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id, requirement_id, location_name, preference)
);

create table if not exists public.commercial_listings (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  title text not null, property_name text not null default '', property_type text not null, transaction_type text not null default 'rent',
  state text not null default '', city text not null default '', area text not null default '', address text not null default '',
  concealed_address text not null default '', latitude numeric(10,7), longitude numeric(10,7), built_up numeric(14,2), land_area numeric(14,2),
  asking_rental numeric(14,2), asking_sale_price numeric(16,2), negotiable boolean not null default false, maintenance_fee numeric(14,2),
  frontage numeric(12,2), ceiling_height numeric(12,2), floor_level text not null default '', corner boolean not null default false,
  ground_floor boolean not null default false, parking integer, loading_bay boolean not null default false,
  three_phase_electricity boolean not null default false, electrical_capacity text not null default '', exhaust boolean not null default false,
  grease_trap boolean not null default false, gas boolean not null default false, water boolean not null default false,
  signage_exposure text not null default '', main_road_frontage boolean not null default false, outdoor_area boolean not null default false,
  swimming_pool boolean not null default false, commercial_zoning boolean not null default false, current_use text not null default '',
  allowed_businesses text[] not null default '{}', prohibited_businesses text[] not null default '{}', furnished_status text not null default '',
  renovation_condition text not null default '', availability_date date, landlord_name text not null default '', landlord_contact text not null default '',
  listing_agent text not null default '', co_broke_status text not null default '', source text not null default '',
  confidentiality_level text not null default 'normal', exact_location_visibility text not null default 'workspace',
  photo_paths text[] not null default '{}', document_paths text[] not null default '{}', notes text not null default '',
  assigned_user_id uuid references auth.users(id) on delete set null, created_by uuid references auth.users(id) on delete set null default auth.uid(),
  status text not null default 'draft', expiry_date date, last_verified_date date, metadata jsonb not null default '{}', deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint commercial_listings_transaction_valid check (transaction_type in ('rent','sale','either')),
  constraint commercial_listings_status_valid check (status in ('draft','active','under_offer','reserved','rented','sold','temporarily_unavailable','expired','archived')),
  constraint commercial_confidentiality_valid check (confidentiality_level in ('normal','internal_only','restricted','highly_confidential')),
  constraint commercial_listings_amounts_valid check (coalesce(built_up,0) >= 0 and coalesce(land_area,0) >= 0 and coalesce(asking_rental,0) >= 0 and coalesce(asking_sale_price,0) >= 0)
);

create table if not exists public.commercial_listing_features (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  listing_id uuid not null references public.commercial_listings(id) on delete cascade, feature_key text not null, feature_value jsonb not null default '{}',
  assigned_user_id uuid references auth.users(id) on delete set null, created_by uuid references auth.users(id) on delete set null default auth.uid(),
  status text not null default 'active', metadata jsonb not null default '{}', deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id, listing_id, feature_key)
);

create table if not exists public.commercial_matches (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  requirement_id uuid not null references public.commercial_requirements(id) on delete cascade,
  listing_id uuid not null references public.commercial_listings(id) on delete cascade,
  overall_score integer not null default 0, category_scores jsonb not null default '{}', matched_criteria text[] not null default '{}',
  missing_criteria text[] not null default '{}', hard_conflicts text[] not null default '{}', warnings text[] not null default '{}',
  recommendation_level text not null default 'unsuitable', explanation text not null default '', shortlist_status text not null default 'unreviewed',
  rejection_reason text not null default '', feedback text not null default '', ai_explanation text not null default '',
  ai_model text not null default '', ai_generated_at timestamptz, score_version text not null default 'deterministic-v1',
  assigned_user_id uuid references auth.users(id) on delete set null, created_by uuid references auth.users(id) on delete set null default auth.uid(),
  status text not null default 'active', metadata jsonb not null default '{}', deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(workspace_id, requirement_id, listing_id), constraint commercial_matches_score_valid check (overall_score between 0 and 100)
);

create table if not exists public.commercial_match_feedback (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  match_id uuid not null references public.commercial_matches(id) on delete cascade, feedback_type text not null, reason text not null default '', notes text not null default '',
  assigned_user_id uuid references auth.users(id) on delete set null, created_by uuid references auth.users(id) on delete set null default auth.uid(),
  status text not null default 'active', metadata jsonb not null default '{}', deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.commercial_deals (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  title text not null, company_id uuid references public.commercial_companies(id) on delete set null, brand_id uuid references public.commercial_brands(id) on delete set null,
  contact_id uuid references public.commercial_contacts(id) on delete set null, requirement_id uuid references public.commercial_requirements(id) on delete set null,
  listing_id uuid references public.commercial_listings(id) on delete set null, landlord_name text not null default '', co_broke_agent text not null default '',
  deal_value numeric(16,2) not null default 0, expected_commission numeric(16,2) not null default 0, commission_share numeric(7,2) not null default 100,
  stage text not null default 'enquiry', probability integer not null default 10, next_action text not null default '', next_follow_up date,
  target_close_date date, actual_close_date date, loss_reason text not null default '', notes text not null default '',
  assigned_user_id uuid references auth.users(id) on delete set null, created_by uuid references auth.users(id) on delete set null default auth.uid(),
  status text not null default 'active', metadata jsonb not null default '{}', deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint commercial_deals_stage_valid check (stage in ('enquiry','qualification','sourcing','proposal','viewing','shortlisted','negotiation','loi','due_diligence','tenancy_agreement','spa','deposit_paid','handover','completed','lost','cancelled')),
  constraint commercial_deals_probability_valid check (probability between 0 and 100)
);

create table if not exists public.commercial_viewings (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  listing_id uuid not null references public.commercial_listings(id) on delete cascade, requirement_id uuid references public.commercial_requirements(id) on delete set null,
  viewing_date timestamptz not null, attendees text[] not null default '{}', location text not null default '', viewing_status text not null default 'scheduled',
  client_feedback text not null default '', landlord_feedback text not null default '', rejection_reason text not null default '', next_step text not null default '', follow_up_date date,
  photo_paths text[] not null default '{}', document_paths text[] not null default '{}', assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(), status text not null default 'active', metadata jsonb not null default '{}', deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.commercial_proposals (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  requirement_id uuid not null references public.commercial_requirements(id) on delete cascade, proposed_date date not null default current_date,
  proposal_language text not null default 'en', internal_notes text not null default '', client_notes text not null default '', response_date date,
  shortlist_result text not null default '', assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(), status text not null default 'draft', metadata jsonb not null default '{}', deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.commercial_proposal_items (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  proposal_id uuid not null references public.commercial_proposals(id) on delete cascade, listing_id uuid not null references public.commercial_listings(id) on delete cascade,
  match_id uuid references public.commercial_matches(id) on delete set null, position integer not null default 1, client_notes text not null default '',
  assigned_user_id uuid references auth.users(id) on delete set null, created_by uuid references auth.users(id) on delete set null default auth.uid(),
  status text not null default 'active', metadata jsonb not null default '{}', deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(workspace_id, proposal_id, listing_id)
);

create table if not exists public.commercial_followups (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  company_id uuid references public.commercial_companies(id) on delete cascade, contact_id uuid references public.commercial_contacts(id) on delete cascade,
  requirement_id uuid references public.commercial_requirements(id) on delete cascade, listing_id uuid references public.commercial_listings(id) on delete cascade,
  deal_id uuid references public.commercial_deals(id) on delete cascade, proposal_id uuid references public.commercial_proposals(id) on delete cascade,
  viewing_id uuid references public.commercial_viewings(id) on delete cascade, follow_up_type text not null default 'call', due_at timestamptz not null,
  completed_at timestamptz, priority text not null default 'normal', note text not null default '', draft_text text not null default '',
  assigned_user_id uuid references auth.users(id) on delete set null, created_by uuid references auth.users(id) on delete set null default auth.uid(),
  status text not null default 'open', metadata jsonb not null default '{}', deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.commercial_activities (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  entity_type text not null, entity_id uuid, activity_type text not null, activity_json jsonb not null default '{}', sensitive_access boolean not null default false,
  assigned_user_id uuid references auth.users(id) on delete set null, created_by uuid references auth.users(id) on delete set null default auth.uid(),
  status text not null default 'recorded', metadata jsonb not null default '{}', deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.commercial_import_jobs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  resource_type text not null, request_hash text not null, source_name text not null default 'commercial-import.csv',
  row_count integer not null default 0, imported_count integer not null default 0, error_count integer not null default 0,
  result_json jsonb not null default '{}', assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(), status text not null default 'processing',
  metadata jsonb not null default '{}', deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint commercial_import_jobs_resource_valid check (resource_type in ('companies','contacts','requirements','listings')),
  constraint commercial_import_jobs_status_valid check (status in ('processing','completed','failed')),
  unique(workspace_id, resource_type, request_hash)
);

create table if not exists public.commercial_listing_media (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete restrict,
  listing_id uuid not null references public.commercial_listings(id) on delete cascade,
  media_type text not null, display_name text not null, storage_bucket text not null default 'commercial-media',
  storage_path text not null, mime_type text not null, file_size bigint not null, sort_order integer not null default 0,
  assigned_user_id uuid references auth.users(id) on delete set null, created_by uuid references auth.users(id) on delete set null default auth.uid(),
  status text not null default 'active', metadata jsonb not null default '{}', deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint commercial_listing_media_type_valid check (media_type in ('property_photo','floor_plan','brochure','tenancy_document','authority_letter','site_plan','proposal_attachment')),
  constraint commercial_listing_media_size_valid check (file_size > 0 and file_size <= 15728640),
  unique(workspace_id, storage_path)
);

create index if not exists commercial_companies_workspace_status_idx on public.commercial_companies(workspace_id, status, next_follow_up);
create index if not exists commercial_contacts_company_idx on public.commercial_contacts(workspace_id, company_id, next_follow_up);
create index if not exists commercial_requirements_matching_idx on public.commercial_requirements(workspace_id, status, transaction_type, expiry_date);
create index if not exists commercial_listings_matching_idx on public.commercial_listings(workspace_id, status, transaction_type, city, area);
create index if not exists commercial_matches_rank_idx on public.commercial_matches(workspace_id, requirement_id, overall_score desc);
create index if not exists commercial_deals_pipeline_idx on public.commercial_deals(workspace_id, stage, next_follow_up);
create index if not exists commercial_followups_due_idx on public.commercial_followups(workspace_id, status, due_at);
create index if not exists commercial_activities_entity_idx on public.commercial_activities(workspace_id, entity_type, entity_id, created_at desc);
create index if not exists commercial_import_jobs_workspace_idx on public.commercial_import_jobs(workspace_id, resource_type, created_at desc);
create index if not exists commercial_listing_media_listing_idx on public.commercial_listing_media(workspace_id, listing_id, sort_order, created_at);

create or replace function public.log_commercial_record_activity()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare action_name text := case when tg_op = 'INSERT' then 'created' else 'updated' end;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'commercial_deals' and (to_jsonb(old) ->> 'stage') is distinct from (to_jsonb(new) ->> 'stage') then
    action_name := 'stage_changed';
  elsif tg_op = 'UPDATE' and tg_table_name = 'commercial_matches' and (to_jsonb(old) ->> 'shortlist_status') is distinct from (to_jsonb(new) ->> 'shortlist_status') then
    action_name := case when (to_jsonb(new) ->> 'shortlist_status') = 'rejected' then 'rejected' else 'shortlisted' end;
  elsif tg_op = 'UPDATE' and tg_table_name = 'commercial_followups' and (to_jsonb(new) ->> 'status') = 'completed' and (to_jsonb(old) ->> 'status') <> 'completed' then
    action_name := 'completed';
  end if;
  insert into public.commercial_activities (
    workspace_id, entity_type, entity_id, activity_type, activity_json, assigned_user_id, created_by
  ) values (
    new.workspace_id, replace(tg_table_name, 'commercial_', ''), new.id,
    replace(tg_table_name, 'commercial_', '') || '_' || action_name,
    jsonb_build_object('status', new.status, 'source', 'database_trigger'), new.assigned_user_id, auth.uid()
  );
  insert into public.activity_logs (workspace_id, entity_type, entity_id, activity_type, activity_json)
  values (new.workspace_id, replace(tg_table_name, 'commercial_', ''), new.id,
    replace(tg_table_name, 'commercial_', '') || '_' || action_name, jsonb_build_object('commercial', true));
  return new;
end;
$$;

revoke all on function public.log_commercial_record_activity() from public, anon;
grant execute on function public.log_commercial_record_activity() to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'commercial_companies','commercial_brands','commercial_contacts','commercial_requirements','commercial_requirement_locations',
    'commercial_listings','commercial_listing_features','commercial_matches','commercial_match_feedback','commercial_deals',
    'commercial_viewings','commercial_proposals','commercial_proposal_items','commercial_followups','commercial_activities',
    'commercial_import_jobs','commercial_listing_media'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, public', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('drop trigger if exists %I_set_updated_at on public.%I', table_name, table_name);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
    execute format('create policy %I on public.%I for select to authenticated using (deleted_at is null and public.is_workspace_member(workspace_id))', table_name || '_workspace_select', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (deleted_at is null and (public.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'']) or (public.has_workspace_role(workspace_id, array[''agent'']) and coalesce(assigned_user_id, auth.uid()) = auth.uid())))', table_name || '_workspace_insert', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'']) or (public.has_workspace_role(workspace_id, array[''agent'']) and (assigned_user_id = auth.uid() or created_by = auth.uid()))) with check (deleted_at is null and (public.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'']) or (public.has_workspace_role(workspace_id, array[''agent'']) and coalesce(assigned_user_id, created_by) = auth.uid())))', table_name || '_workspace_update', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_workspace_role(workspace_id, array[''owner'',''admin'']))', table_name || '_workspace_delete', table_name);
  end loop;
end;
$$;

-- Sensitive contact details and confidential listing locations must not be
-- retrievable through direct PostgREST calls that bypass server-side masking.
drop policy commercial_contacts_workspace_select on public.commercial_contacts;
create policy commercial_contacts_workspace_select on public.commercial_contacts
for select to authenticated using (
  deleted_at is null and (
    public.has_workspace_role(workspace_id, array['owner','admin','manager'])
    or (public.has_workspace_role(workspace_id, array['agent']) and (assigned_user_id = auth.uid() or created_by = auth.uid()))
  )
);

drop policy commercial_listings_workspace_select on public.commercial_listings;
create policy commercial_listings_workspace_select on public.commercial_listings
for select to authenticated using (
  deleted_at is null and (
    (confidentiality_level = 'normal' and public.is_workspace_member(workspace_id))
    or public.has_workspace_role(workspace_id, array['owner','admin','manager'])
    or (public.has_workspace_role(workspace_id, array['agent']) and (assigned_user_id = auth.uid() or created_by = auth.uid()))
  )
);

drop policy commercial_listing_media_workspace_select on public.commercial_listing_media;
create policy commercial_listing_media_workspace_select on public.commercial_listing_media
for select to authenticated using (
  deleted_at is null and exists (
    select 1 from public.commercial_listings listing
    where listing.id = commercial_listing_media.listing_id and listing.workspace_id = commercial_listing_media.workspace_id and listing.deleted_at is null
      and (
        listing.confidentiality_level = 'normal'
        or public.has_workspace_role(listing.workspace_id, array['owner','admin','manager'])
        or (public.has_workspace_role(listing.workspace_id, array['agent']) and (listing.assigned_user_id = auth.uid() or listing.created_by = auth.uid()))
      )
  )
);

create policy commercial_listing_media_agent_delete on public.commercial_listing_media for delete to authenticated using (
  public.has_workspace_role(workspace_id, array['agent']) and assigned_user_id = auth.uid()
);

create policy commercial_proposal_items_agent_delete on public.commercial_proposal_items for delete to authenticated using (
  public.has_workspace_role(workspace_id, array['agent']) and assigned_user_id = auth.uid()
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'commercial_companies','commercial_brands','commercial_contacts','commercial_requirements','commercial_listings',
    'commercial_matches','commercial_deals','commercial_viewings','commercial_proposals','commercial_followups'
  ] loop
    execute format('drop trigger if exists %I_activity on public.%I', table_name, table_name);
    execute format('create trigger %I_activity after insert or update on public.%I for each row execute function public.log_commercial_record_activity()', table_name, table_name);
  end loop;
end;
$$;

-- Finance can maintain deal financials but cannot modify listing/contact identity.
create policy commercial_deals_finance_update on public.commercial_deals for update to authenticated
using (public.has_workspace_role(workspace_id, array['finance']))
with check (public.has_workspace_role(workspace_id, array['finance']));

create or replace function public.enforce_commercial_deal_finance_fields()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if public.has_workspace_role(old.workspace_id, array['finance'])
    and not public.has_workspace_role(old.workspace_id, array['owner','admin','manager','agent'])
    and (to_jsonb(new) - array['deal_value','expected_commission','commission_share','probability','notes','updated_at']::text[])
      is distinct from (to_jsonb(old) - array['deal_value','expected_commission','commission_share','probability','notes','updated_at']::text[])
  then
    raise exception 'finance_role_field_restricted' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_commercial_deal_finance_fields() from public, anon;
grant execute on function public.enforce_commercial_deal_finance_fields() to authenticated;
create trigger commercial_deals_finance_field_guard before update on public.commercial_deals
for each row execute function public.enforce_commercial_deal_finance_fields();

create or replace function public.enforce_commercial_deal_stage_transition()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare allowed text[];
begin
  if new.stage = old.stage then return new; end if;
  allowed := case old.stage
    when 'enquiry' then array['qualification','lost','cancelled']
    when 'qualification' then array['sourcing','lost','cancelled']
    when 'sourcing' then array['proposal','lost','cancelled']
    when 'proposal' then array['viewing','lost','cancelled']
    when 'viewing' then array['shortlisted','lost','cancelled']
    when 'shortlisted' then array['negotiation','lost','cancelled']
    when 'negotiation' then array['loi','lost','cancelled']
    when 'loi' then array['due_diligence','lost','cancelled']
    when 'due_diligence' then array['tenancy_agreement','spa','lost','cancelled']
    when 'tenancy_agreement' then array['deposit_paid','lost','cancelled']
    when 'spa' then array['deposit_paid','lost','cancelled']
    when 'deposit_paid' then array['handover','cancelled']
    when 'handover' then array['completed']
    else array[]::text[]
  end;
  if not new.stage = any(allowed) then raise exception 'invalid_deal_stage_transition' using errcode = '23514'; end if;
  return new;
end;
$$;

revoke all on function public.enforce_commercial_deal_stage_transition() from public, anon;
grant execute on function public.enforce_commercial_deal_stage_transition() to authenticated;
create trigger commercial_deals_stage_guard before update on public.commercial_deals
for each row execute function public.enforce_commercial_deal_stage_transition();

create or replace function public.enforce_commercial_workspace_references()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare payload jsonb := to_jsonb(new); reference_id uuid;
begin
  if nullif(payload ->> 'assigned_user_id', '') is not null then
    reference_id := (payload ->> 'assigned_user_id')::uuid;
    if not exists (select 1 from public.workspace_members where user_id = reference_id and workspace_id = new.workspace_id and status = 'active') then raise exception 'commercial_assignee_not_in_workspace' using errcode = '23503'; end if;
  end if;
  if nullif(payload ->> 'company_id', '') is not null then
    reference_id := (payload ->> 'company_id')::uuid;
    if not exists (select 1 from public.commercial_companies where id = reference_id and workspace_id = new.workspace_id and deleted_at is null) then raise exception 'commercial_cross_workspace_company' using errcode = '23503'; end if;
  end if;
  if nullif(payload ->> 'brand_id', '') is not null then
    reference_id := (payload ->> 'brand_id')::uuid;
    if not exists (select 1 from public.commercial_brands where id = reference_id and workspace_id = new.workspace_id and deleted_at is null) then raise exception 'commercial_cross_workspace_brand' using errcode = '23503'; end if;
  end if;
  if nullif(payload ->> 'contact_id', '') is not null then
    reference_id := (payload ->> 'contact_id')::uuid;
    if not exists (select 1 from public.commercial_contacts where id = reference_id and workspace_id = new.workspace_id and deleted_at is null) then raise exception 'commercial_cross_workspace_contact' using errcode = '23503'; end if;
  end if;
  if nullif(payload ->> 'requirement_id', '') is not null then
    reference_id := (payload ->> 'requirement_id')::uuid;
    if not exists (select 1 from public.commercial_requirements where id = reference_id and workspace_id = new.workspace_id and deleted_at is null) then raise exception 'commercial_cross_workspace_requirement' using errcode = '23503'; end if;
  end if;
  if nullif(payload ->> 'listing_id', '') is not null then
    reference_id := (payload ->> 'listing_id')::uuid;
    if not exists (select 1 from public.commercial_listings where id = reference_id and workspace_id = new.workspace_id and deleted_at is null) then raise exception 'commercial_cross_workspace_listing' using errcode = '23503'; end if;
  end if;
  if nullif(payload ->> 'match_id', '') is not null then
    reference_id := (payload ->> 'match_id')::uuid;
    if not exists (select 1 from public.commercial_matches where id = reference_id and workspace_id = new.workspace_id and deleted_at is null) then raise exception 'commercial_cross_workspace_match' using errcode = '23503'; end if;
  end if;
  if nullif(payload ->> 'deal_id', '') is not null then
    reference_id := (payload ->> 'deal_id')::uuid;
    if not exists (select 1 from public.commercial_deals where id = reference_id and workspace_id = new.workspace_id and deleted_at is null) then raise exception 'commercial_cross_workspace_deal' using errcode = '23503'; end if;
  end if;
  if nullif(payload ->> 'proposal_id', '') is not null then
    reference_id := (payload ->> 'proposal_id')::uuid;
    if not exists (select 1 from public.commercial_proposals where id = reference_id and workspace_id = new.workspace_id and deleted_at is null) then raise exception 'commercial_cross_workspace_proposal' using errcode = '23503'; end if;
  end if;
  if nullif(payload ->> 'viewing_id', '') is not null then
    reference_id := (payload ->> 'viewing_id')::uuid;
    if not exists (select 1 from public.commercial_viewings where id = reference_id and workspace_id = new.workspace_id and deleted_at is null) then raise exception 'commercial_cross_workspace_viewing' using errcode = '23503'; end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_commercial_workspace_references() from public, anon;
grant execute on function public.enforce_commercial_workspace_references() to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'commercial_companies','commercial_brands','commercial_contacts','commercial_requirements','commercial_requirement_locations','commercial_listings','commercial_listing_features',
    'commercial_matches','commercial_match_feedback','commercial_deals','commercial_viewings','commercial_proposals','commercial_proposal_items',
    'commercial_followups','commercial_listing_media','commercial_import_jobs'
  ] loop
    execute format('create trigger %I_workspace_reference_guard before insert or update on public.%I for each row execute function public.enforce_commercial_workspace_references()', table_name, table_name);
  end loop;
end;
$$;

create or replace function public.commercial_confidential_listing_summaries(p_workspace_id uuid, p_listing_id uuid default null)
returns table (
  id uuid, title text, property_type text, area text, transaction_type text,
  approximate_built_up_min numeric, approximate_built_up_max numeric,
  approximate_land_min numeric, approximate_land_max numeric,
  approximate_rental_min numeric, approximate_rental_max numeric,
  approximate_sale_min numeric, approximate_sale_max numeric,
  availability_status text, confidentiality_level text, assigned_user_id uuid, assigned_agent text, suitability text, summary_only boolean
)
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is null or not public.is_workspace_member(p_workspace_id) then
    raise exception 'permission_denied' using errcode = '42501';
  end if;
  return query
  select listing.id, 'Confidential commercial listing'::text, listing.property_type, coalesce(nullif(listing.area, ''), nullif(listing.city, ''), listing.state), listing.transaction_type,
    case when listing.built_up is null then null else floor(listing.built_up / 500) * 500 end,
    case when listing.built_up is null then null else floor(listing.built_up / 500) * 500 + 500 end,
    case when listing.land_area is null then null else floor(listing.land_area / 1000) * 1000 end,
    case when listing.land_area is null then null else floor(listing.land_area / 1000) * 1000 + 1000 end,
    case when listing.asking_rental is null then null else floor(listing.asking_rental / 5000) * 5000 end,
    case when listing.asking_rental is null then null else floor(listing.asking_rental / 5000) * 5000 + 5000 end,
    case when listing.asking_sale_price is null then null else floor(listing.asking_sale_price / 100000) * 100000 end,
    case when listing.asking_sale_price is null then null else floor(listing.asking_sale_price / 100000) * 100000 + 100000 end,
    listing.status, listing.confidentiality_level, listing.assigned_user_id, coalesce(nullif(profile.full_name, ''), 'Assigned agent'), 'Requires requirement matching'::text, true
  from public.commercial_listings listing
  left join public.profiles profile on profile.id = listing.assigned_user_id
  where listing.workspace_id = p_workspace_id and listing.deleted_at is null and listing.confidentiality_level = 'highly_confidential'
    and (p_listing_id is null or listing.id = p_listing_id)
    and not (
      public.has_workspace_role(p_workspace_id, array['owner','admin','manager'])
      or (public.has_workspace_role(p_workspace_id, array['agent']) and (listing.assigned_user_id = auth.uid() or listing.created_by = auth.uid()))
    );
end;
$$;

revoke all on function public.commercial_confidential_listing_summaries(uuid, uuid) from public, anon;
grant execute on function public.commercial_confidential_listing_summaries(uuid, uuid) to authenticated;

create or replace function public.commercial_storage_listing_id(object_name text)
returns uuid language plpgsql immutable strict security invoker set search_path = pg_catalog as $$
begin
  return split_part(object_name, '/', 3)::uuid;
exception when others then
  return null;
end;
$$;

revoke all on function public.commercial_storage_listing_id(text) from public, anon;
grant execute on function public.commercial_storage_listing_id(text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('commercial-media', 'commercial-media', false, 15728640, array['image/jpeg','image/png','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "commercial media read" on storage.objects for select to authenticated using (
  bucket_id = 'commercial-media' and exists (
    select 1 from public.commercial_listings listing
    where listing.id = public.commercial_storage_listing_id(name)
      and listing.workspace_id = public.storage_workspace_id(name) and listing.deleted_at is null
      and (
        listing.confidentiality_level = 'normal'
        or public.has_workspace_role(listing.workspace_id, array['owner','admin','manager'])
        or (public.has_workspace_role(listing.workspace_id, array['agent']) and (listing.assigned_user_id = auth.uid() or listing.created_by = auth.uid()))
      )
  )
);

create policy "commercial media insert" on storage.objects for insert to authenticated with check (
  bucket_id = 'commercial-media' and exists (
    select 1 from public.commercial_listings listing
    where listing.id = public.commercial_storage_listing_id(name)
      and listing.workspace_id = public.storage_workspace_id(name) and listing.deleted_at is null
      and (
        public.has_workspace_role(listing.workspace_id, array['owner','admin','manager'])
        or (public.has_workspace_role(listing.workspace_id, array['agent']) and (listing.assigned_user_id = auth.uid() or listing.created_by = auth.uid()))
      )
  )
);

create policy "commercial media delete" on storage.objects for delete to authenticated using (
  bucket_id = 'commercial-media' and exists (
    select 1 from public.commercial_listings listing
    where listing.id = public.commercial_storage_listing_id(name)
      and listing.workspace_id = public.storage_workspace_id(name)
      and (
        public.has_workspace_role(listing.workspace_id, array['owner','admin','manager'])
        or (public.has_workspace_role(listing.workspace_id, array['agent']) and listing.assigned_user_id = auth.uid())
      )
  )
);
