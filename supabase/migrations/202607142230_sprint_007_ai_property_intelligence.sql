-- Sprint 007 AI Property Intelligence Engine.
-- Additive only. Residential and commercial source records remain unchanged.

create table if not exists public.property_analyses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  tenancy_id uuid references public.tenancies(id) on delete cascade,
  commercial_listing_id uuid references public.commercial_listings(id) on delete cascade,
  property_source text not null,
  property_name text not null,
  property_address text not null default '',
  property_type text not null default '',
  latitude numeric(10,7), longitude numeric(10,7), built_up_sqft numeric(14,2),
  purchase_price numeric(16,2), down_payment numeric(16,2),
  estimated_market_value numeric(16,2), estimated_monthly_rental numeric(14,2),
  monthly_operating_cost numeric(14,2) not null default 0,
  monthly_financing_cost numeric(14,2) not null default 0,
  occupancy_rate numeric(5,2) not null default 100,
  annual_capital_growth_rate numeric(6,2) not null default 0,
  rental_yield numeric(8,2), annual_roi numeric(8,2), monthly_cashflow numeric(16,2),
  market_value_method text not null default 'insufficient evidence',
  rental_method text not null default 'insufficient evidence',
  summary_en text not null default '', summary_zh text not null default '',
  marketing_description_en text not null default '', marketing_description_zh text not null default '',
  strengths_en text[] not null default '{}', strengths_zh text[] not null default '{}',
  weaknesses_en text[] not null default '{}', weaknesses_zh text[] not null default '{}',
  suitable_tenant_profile_en text not null default '', suitable_tenant_profile_zh text not null default '',
  suitable_buyer_profile_en text not null default '', suitable_buyer_profile_zh text not null default '',
  commercial_suitability_en text not null default '', commercial_suitability_zh text not null default '',
  investment_opinion_en text not null default '', investment_opinion_zh text not null default '',
  analysis_status text not null default 'draft', data_quality_score integer not null default 0,
  warnings text[] not null default '{}', methodology jsonb not null default '{}',
  ai_model text not null default '', ai_generated_at timestamptz,
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint property_analyses_one_source check (num_nonnulls(tenancy_id, commercial_listing_id) = 1),
  constraint property_analyses_source_valid check (
    (property_source = 'residential_tenancy' and tenancy_id is not null and commercial_listing_id is null)
    or (property_source = 'commercial_listing' and commercial_listing_id is not null and tenancy_id is null)
  ),
  constraint property_analyses_required_name check (length(btrim(property_name)) > 0),
  constraint property_analyses_coordinates_valid check ((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180)),
  constraint property_analyses_amounts_valid check (
    coalesce(built_up_sqft,0) >= 0 and coalesce(purchase_price,0) >= 0 and coalesce(down_payment,0) >= 0
    and coalesce(estimated_market_value,0) >= 0 and coalesce(estimated_monthly_rental,0) >= 0
    and monthly_operating_cost >= 0 and monthly_financing_cost >= 0
  ),
  constraint property_analyses_rates_valid check (occupancy_rate between 0 and 100 and annual_capital_growth_rate between -100 and 100),
  constraint property_analyses_metrics_valid check (coalesce(rental_yield,0) >= 0 and data_quality_score between 0 and 100),
  constraint property_analyses_status_valid check (analysis_status in ('draft','generated','reviewed'))
);

create unique index if not exists property_analyses_active_tenancy_unique
  on public.property_analyses(workspace_id, tenancy_id) where tenancy_id is not null and deleted_at is null;
create unique index if not exists property_analyses_active_listing_unique
  on public.property_analyses(workspace_id, commercial_listing_id) where commercial_listing_id is not null and deleted_at is null;
create index if not exists property_analyses_workspace_status_idx
  on public.property_analyses(workspace_id, analysis_status, updated_at desc) where deleted_at is null;

create table if not exists public.property_comparables (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  analysis_id uuid not null references public.property_analyses(id) on delete cascade,
  comparable_type text not null,
  property_name text not null,
  property_address text not null default '', property_type text not null default '',
  latitude numeric(10,7), longitude numeric(10,7),
  price numeric(16,2), rental numeric(14,2), built_up_sqft numeric(14,2), psf numeric(14,4), distance_km numeric(10,2),
  transaction_date date, source_name text not null, source_url text not null default '', source_reference text not null default '',
  verification_status text not null default 'unverified', verified_at timestamptz, notes text not null default '',
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint property_comparables_type_valid check (comparable_type in ('sale','rental')),
  constraint property_comparables_required_text check (length(btrim(property_name)) > 0 and length(btrim(source_name)) > 0),
  constraint property_comparables_coordinates_valid check ((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180)),
  constraint property_comparables_amounts_valid check (coalesce(price,0) >= 0 and coalesce(rental,0) >= 0 and coalesce(built_up_sqft,0) >= 0 and coalesce(psf,0) >= 0 and coalesce(distance_km,0) >= 0),
  constraint property_comparables_value_present check ((comparable_type = 'sale' and price is not null) or (comparable_type = 'rental' and rental is not null)),
  constraint property_comparables_verification_valid check (verification_status in ('unverified','verified','rejected'))
);
create index if not exists property_comparables_analysis_type_idx
  on public.property_comparables(workspace_id, analysis_id, comparable_type, transaction_date desc) where deleted_at is null;
create unique index if not exists property_comparables_source_reference_unique
  on public.property_comparables(workspace_id, analysis_id, source_name, source_reference)
  where source_reference <> '' and deleted_at is null;

create table if not exists public.property_nearby_places (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  analysis_id uuid not null references public.property_analyses(id) on delete cascade,
  category text not null, name text not null,
  latitude numeric(10,7) not null, longitude numeric(10,7) not null,
  distance_km numeric(10,2), travel_time_minutes integer, travel_mode text not null default 'driving',
  source_name text not null, source_reference text not null default '', verified_at timestamptz, notes text not null default '',
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint property_nearby_category_valid check (category in ('public_transport','school','hospital','shopping_mall','restaurant','petrol_station','other')),
  constraint property_nearby_required_text check (length(btrim(name)) > 0 and length(btrim(source_name)) > 0),
  constraint property_nearby_coordinates_valid check (latitude between -90 and 90 and longitude between -180 and 180),
  constraint property_nearby_distance_valid check (coalesce(distance_km,0) >= 0 and coalesce(travel_time_minutes,0) >= 0),
  constraint property_nearby_travel_mode_valid check (travel_mode in ('driving','walking','transit','cycling'))
);
create index if not exists property_nearby_analysis_category_idx
  on public.property_nearby_places(workspace_id, analysis_id, category, distance_km) where deleted_at is null;
create unique index if not exists property_nearby_source_reference_unique
  on public.property_nearby_places(workspace_id, analysis_id, source_name, source_reference)
  where source_reference <> '' and deleted_at is null;

create table if not exists public.property_scores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  analysis_id uuid not null references public.property_analyses(id) on delete cascade,
  location_score integer not null, accessibility_score integer not null, amenities_score integer not null,
  rental_demand_score integer not null, capital_growth_score integer not null, commercial_potential_score integer not null,
  overall_score integer not null, data_completeness integer not null,
  rationale jsonb not null default '{}', score_version text not null default 'property-score-v1', calculated_at timestamptz not null default now(),
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint property_scores_analysis_unique unique(workspace_id, analysis_id),
  constraint property_scores_ranges_valid check (
    location_score between 0 and 100 and accessibility_score between 0 and 100 and amenities_score between 0 and 100
    and rental_demand_score between 0 and 100 and capital_growth_score between 0 and 100
    and commercial_potential_score between 0 and 100 and overall_score between 0 and 100 and data_completeness between 0 and 100
  )
);
create index if not exists property_scores_workspace_overall_idx
  on public.property_scores(workspace_id, overall_score desc) where deleted_at is null;

create or replace function public.enforce_property_intelligence_workspace()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare parent_workspace uuid;
begin
  if tg_table_name = 'property_analyses' then
    if new.tenancy_id is not null then
      select workspace_id into parent_workspace from public.tenancies where id = new.tenancy_id;
    else
      select workspace_id into parent_workspace from public.commercial_listings where id = new.commercial_listing_id;
    end if;
    if parent_workspace is null or parent_workspace <> new.workspace_id then
      raise exception 'property_intelligence_cross_workspace_source' using errcode = '23503';
    end if;
  else
    select workspace_id into parent_workspace from public.property_analyses where id = new.analysis_id and deleted_at is null;
    if parent_workspace is null or parent_workspace <> new.workspace_id then
      raise exception 'property_intelligence_cross_workspace_parent' using errcode = '23503';
    end if;
  end if;
  if new.assigned_user_id is not null and not exists (
    select 1 from public.workspace_members where workspace_id = new.workspace_id and user_id = new.assigned_user_id and status = 'active'
  ) then
    raise exception 'property_intelligence_assignee_not_in_workspace' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_property_intelligence_workspace() from public, anon;
grant execute on function public.enforce_property_intelligence_workspace() to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['property_analyses','property_comparables','property_nearby_places','property_scores'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, public', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('drop trigger if exists %I_set_updated_at on public.%I', table_name, table_name);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
    execute format('drop trigger if exists %I_workspace_guard on public.%I', table_name, table_name);
    execute format('create trigger %I_workspace_guard before insert or update on public.%I for each row execute function public.enforce_property_intelligence_workspace()', table_name, table_name);
    execute format('create policy %I on public.%I for select to authenticated using (deleted_at is null and public.is_workspace_member(workspace_id))', table_name || '_workspace_select', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (deleted_at is null and (public.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'']) or (public.has_workspace_role(workspace_id, array[''agent'']) and coalesce(assigned_user_id, auth.uid()) = auth.uid())))', table_name || '_workspace_insert', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'']) or (public.has_workspace_role(workspace_id, array[''agent'']) and (assigned_user_id = auth.uid() or created_by = auth.uid()))) with check (deleted_at is null and (public.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'']) or (public.has_workspace_role(workspace_id, array[''agent'']) and coalesce(assigned_user_id, created_by) = auth.uid())))', table_name || '_workspace_update', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_workspace_role(workspace_id, array[''owner'',''admin'']))', table_name || '_workspace_delete', table_name);
  end loop;
end;
$$;

-- Confidential commercial listings remain protected when accessed through analyses.
drop policy property_analyses_workspace_select on public.property_analyses;
create policy property_analyses_workspace_select on public.property_analyses for select to authenticated using (
  deleted_at is null and public.is_workspace_member(workspace_id) and (
    tenancy_id is not null
    or exists (select 1 from public.commercial_listings listing where listing.id = commercial_listing_id and listing.workspace_id = workspace_id and listing.deleted_at is null)
  )
);

-- Child evidence inherits the source property's visibility, preventing a
-- confidential listing from being inferred through direct Data API access.
drop policy property_comparables_workspace_select on public.property_comparables;
create policy property_comparables_workspace_select on public.property_comparables for select to authenticated using (
  deleted_at is null and public.is_workspace_member(workspace_id)
  and exists (select 1 from public.property_analyses analysis where analysis.id = analysis_id and analysis.workspace_id = workspace_id and analysis.deleted_at is null)
);
drop policy property_nearby_places_workspace_select on public.property_nearby_places;
create policy property_nearby_places_workspace_select on public.property_nearby_places for select to authenticated using (
  deleted_at is null and public.is_workspace_member(workspace_id)
  and exists (select 1 from public.property_analyses analysis where analysis.id = analysis_id and analysis.workspace_id = workspace_id and analysis.deleted_at is null)
);
drop policy property_scores_workspace_select on public.property_scores;
create policy property_scores_workspace_select on public.property_scores for select to authenticated using (
  deleted_at is null and public.is_workspace_member(workspace_id)
  and exists (select 1 from public.property_analyses analysis where analysis.id = analysis_id and analysis.workspace_id = workspace_id and analysis.deleted_at is null)
);

-- Agents may remove only evidence they own; deleting a complete analysis remains
-- restricted to workspace owners and admins by the general delete policy.
create policy property_comparables_agent_delete on public.property_comparables for delete to authenticated using (
  public.has_workspace_role(workspace_id, array['agent']) and (assigned_user_id = auth.uid() or created_by = auth.uid())
);
create policy property_nearby_places_agent_delete on public.property_nearby_places for delete to authenticated using (
  public.has_workspace_role(workspace_id, array['agent']) and (assigned_user_id = auth.uid() or created_by = auth.uid())
);
