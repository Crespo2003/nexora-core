-- Sprint 007: additive agent CRM, appointments, and shared deal journey.
-- Existing tenancy extraction, commercial CRM, and contact intelligence remain intact.

alter table public.contacts
  add column if not exists client_type text not null default 'prospect'
    check (client_type in ('prospect','tenant','buyer','investor','landlord','owner','commercial_tenant','commercial_buyer','company','other')),
  add column if not exists nationality text not null default '',
  add column if not exists source text not null default '',
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null,
  add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid(),
  add column if not exists last_contact_at timestamptz,
  add column if not exists archived_at timestamptz;

create table if not exists public.crm_enquiries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  enquiry_number text not null,
  contact_id uuid not null,
  transaction_type text not null check (transaction_type in ('rent','buy','subsale','commercial_rent','commercial_buy','land','new_project')),
  property_type text not null default '',
  preferred_areas text[] not null default '{}',
  budget_min numeric(16,2),
  budget_max numeric(16,2),
  bedrooms_min integer,
  bathrooms_min integer,
  size_min numeric(14,2),
  size_max numeric(14,2),
  furnishing text not null default '',
  move_in_date date,
  parking_requirement text not null default '',
  pet_requirement text not null default '',
  special_requirements text not null default '',
  commercial_requirements text not null default '',
  source text not null default '',
  priority text not null default 'normal' check (priority in ('hot','warm','normal','low')),
  stage text not null default 'NEW_ENQUIRY',
  status text not null default 'active' check (status in ('active','closed','lost','archived')),
  lost_reason text not null default '',
  notes text not null default '',
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  last_contact_at timestamptz,
  next_follow_up_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_enquiries_number_workspace_unique unique (workspace_id, enquiry_number),
  constraint crm_enquiries_budget_valid check (
    coalesce(budget_min, 0) >= 0 and coalesce(budget_max, 0) >= 0
    and (budget_min is null or budget_max is null or budget_min <= budget_max)
  ),
  constraint crm_enquiries_size_valid check (
    coalesce(size_min, 0) >= 0 and coalesce(size_max, 0) >= 0
    and (size_min is null or size_max is null or size_min <= size_max)
  ),
  constraint crm_enquiries_rooms_valid check (coalesce(bedrooms_min, 0) >= 0 and coalesce(bathrooms_min, 0) >= 0),
  constraint crm_enquiries_stage_valid check (stage in (
    'NEW_ENQUIRY','CONTACTED','QUALIFIED','MATCHED','VIEWING_SCHEDULED','VIEWING_COMPLETED',
    'FOLLOW_UP','NEGOTIATION','BOOKING','LEGAL','HANDOVER','CLOSED','LOST','AFTER_SALES'
  ))
);

create table if not exists public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  deal_number text not null,
  title text not null,
  contact_id uuid not null,
  enquiry_id uuid,
  transaction_type text not null check (transaction_type in ('rent','buy','subsale','commercial_rent','commercial_buy','land','new_project')),
  commercial_listing_id uuid,
  listing_reference text not null default '',
  stage text not null default 'NEW_ENQUIRY',
  status text not null default 'active' check (status in ('active','closed','lost','archived')),
  deal_value numeric(16,2),
  expected_commission numeric(16,2),
  probability integer check (probability between 0 and 100),
  lost_reason text not null default '',
  notes text not null default '',
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  closed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_deals_number_workspace_unique unique (workspace_id, deal_number),
  constraint crm_deals_amounts_valid check (coalesce(deal_value,0) >= 0 and coalesce(expected_commission,0) >= 0),
  constraint crm_deals_stage_valid check (stage in (
    'NEW_ENQUIRY','CONTACTED','QUALIFIED','MATCHED','VIEWING_SCHEDULED','VIEWING_COMPLETED',
    'FOLLOW_UP','NEGOTIATION','BOOKING','LEGAL','HANDOVER','CLOSED','LOST','AFTER_SALES'
  ))
);

create table if not exists public.crm_appointments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  appointment_type text not null check (appointment_type in (
    'property_viewing','owner_meeting','tenant_meeting','buyer_meeting','commercial_site_visit',
    'negotiation_meeting','signing','handover','inspection','follow_up','internal_meeting'
  )),
  contact_id uuid,
  enquiry_id uuid,
  deal_id uuid,
  commercial_listing_id uuid,
  listing_reference text not null default '',
  location text not null default '',
  meeting_point text not null default '',
  address text not null default '',
  map_url text not null default '',
  start_at timestamptz not null,
  end_at timestamptz,
  status text not null default 'proposed' check (status in ('proposed','confirmed','rescheduled','completed','cancelled','no_show')),
  reminder_minutes integer not null default 60 check (reminder_minutes between 0 and 10080),
  outcome text not null default '',
  follow_up_at timestamptz,
  notes text not null default '',
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_appointments_time_valid check (end_at is null or end_at > start_at)
);

create table if not exists public.crm_follow_ups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  contact_id uuid,
  enquiry_id uuid,
  appointment_id uuid,
  deal_id uuid,
  commercial_listing_id uuid,
  listing_reference text not null default '',
  due_at timestamptz not null,
  method text not null default 'call' check (method in ('whatsapp','call','email','meeting','viewing','internal_task')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status text not null default 'pending' check (status in ('pending','completed','snoozed','cancelled')),
  notes text not null default '',
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_follow_ups_link_valid check (
    contact_id is not null or enquiry_id is not null or appointment_id is not null
    or deal_id is not null or commercial_listing_id is not null or listing_reference <> ''
  )
);

create table if not exists public.crm_listing_matches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  enquiry_id uuid not null,
  commercial_listing_id uuid,
  listing_reference text not null default '',
  listing_title text not null default '',
  match_score integer check (match_score between 0 and 100),
  match_status text not null default 'suggested' check (match_status in ('suggested','sent_to_client','interested','not_interested','viewing_requested','shortlisted','rejected')),
  client_response text not null default '',
  notes text not null default '',
  assigned_user_id uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_listing_matches_reference_valid check (commercial_listing_id is not null or listing_reference <> ''),
  constraint crm_listing_matches_unique unique (workspace_id, enquiry_id, commercial_listing_id, listing_reference)
);

create table if not exists public.crm_enquiry_stage_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  enquiry_id uuid not null,
  from_stage text,
  to_stage text not null,
  note text not null default '',
  changed_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.crm_deal_stage_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  deal_id uuid not null,
  from_stage text,
  to_stage text not null,
  note text not null default '',
  changed_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

alter table public.contacts add constraint contacts_workspace_id_unique unique (workspace_id, id);
alter table public.commercial_listings add constraint commercial_listings_workspace_id_unique unique (workspace_id, id);
alter table public.crm_enquiries add constraint crm_enquiries_workspace_id_unique unique (workspace_id, id);
alter table public.crm_deals add constraint crm_deals_workspace_id_unique unique (workspace_id, id);
alter table public.crm_appointments add constraint crm_appointments_workspace_id_unique unique (workspace_id, id);

alter table public.crm_enquiries add constraint crm_enquiries_contact_workspace_fk
  foreign key (workspace_id, contact_id) references public.contacts(workspace_id, id);
alter table public.crm_deals add constraint crm_deals_contact_workspace_fk
  foreign key (workspace_id, contact_id) references public.contacts(workspace_id, id);
alter table public.crm_deals add constraint crm_deals_enquiry_workspace_fk
  foreign key (workspace_id, enquiry_id) references public.crm_enquiries(workspace_id, id);
alter table public.crm_deals add constraint crm_deals_commercial_listing_workspace_fk
  foreign key (workspace_id, commercial_listing_id) references public.commercial_listings(workspace_id, id);
alter table public.crm_appointments add constraint crm_appointments_contact_workspace_fk
  foreign key (workspace_id, contact_id) references public.contacts(workspace_id, id);
alter table public.crm_appointments add constraint crm_appointments_enquiry_workspace_fk
  foreign key (workspace_id, enquiry_id) references public.crm_enquiries(workspace_id, id);
alter table public.crm_appointments add constraint crm_appointments_deal_workspace_fk
  foreign key (workspace_id, deal_id) references public.crm_deals(workspace_id, id);
alter table public.crm_appointments add constraint crm_appointments_commercial_listing_workspace_fk
  foreign key (workspace_id, commercial_listing_id) references public.commercial_listings(workspace_id, id);
alter table public.crm_follow_ups add constraint crm_follow_ups_contact_workspace_fk
  foreign key (workspace_id, contact_id) references public.contacts(workspace_id, id);
alter table public.crm_follow_ups add constraint crm_follow_ups_enquiry_workspace_fk
  foreign key (workspace_id, enquiry_id) references public.crm_enquiries(workspace_id, id);
alter table public.crm_follow_ups add constraint crm_follow_ups_appointment_workspace_fk
  foreign key (workspace_id, appointment_id) references public.crm_appointments(workspace_id, id);
alter table public.crm_follow_ups add constraint crm_follow_ups_deal_workspace_fk
  foreign key (workspace_id, deal_id) references public.crm_deals(workspace_id, id);
alter table public.crm_follow_ups add constraint crm_follow_ups_commercial_listing_workspace_fk
  foreign key (workspace_id, commercial_listing_id) references public.commercial_listings(workspace_id, id);
alter table public.crm_listing_matches add constraint crm_listing_matches_enquiry_workspace_fk
  foreign key (workspace_id, enquiry_id) references public.crm_enquiries(workspace_id, id);
alter table public.crm_listing_matches add constraint crm_listing_matches_commercial_listing_workspace_fk
  foreign key (workspace_id, commercial_listing_id) references public.commercial_listings(workspace_id, id);
alter table public.crm_enquiry_stage_history add constraint crm_enquiry_stage_history_enquiry_workspace_fk
  foreign key (workspace_id, enquiry_id) references public.crm_enquiries(workspace_id, id) on delete cascade;
alter table public.crm_deal_stage_history add constraint crm_deal_stage_history_deal_workspace_fk
  foreign key (workspace_id, deal_id) references public.crm_deals(workspace_id, id) on delete cascade;

create index if not exists contacts_workspace_assignee_active_idx on public.contacts(workspace_id, assigned_user_id, updated_at desc) where archived_at is null;
create index if not exists crm_enquiries_workspace_stage_updated_idx on public.crm_enquiries(workspace_id, stage, updated_at desc) where archived_at is null;
create index if not exists crm_enquiries_workspace_assignee_followup_idx on public.crm_enquiries(workspace_id, assigned_user_id, next_follow_up_at) where archived_at is null;
create index if not exists crm_enquiries_workspace_contact_idx on public.crm_enquiries(workspace_id, contact_id);
create index if not exists crm_deals_workspace_stage_updated_idx on public.crm_deals(workspace_id, stage, updated_at desc) where archived_at is null;
create index if not exists crm_deals_workspace_assignee_idx on public.crm_deals(workspace_id, assigned_user_id) where archived_at is null;
create index if not exists crm_appointments_workspace_start_idx on public.crm_appointments(workspace_id, start_at, status);
create index if not exists crm_appointments_workspace_assignee_idx on public.crm_appointments(workspace_id, assigned_user_id, start_at);
create index if not exists crm_follow_ups_workspace_due_idx on public.crm_follow_ups(workspace_id, status, due_at);
create index if not exists crm_follow_ups_workspace_assignee_idx on public.crm_follow_ups(workspace_id, assigned_user_id, due_at);
create index if not exists crm_listing_matches_workspace_enquiry_idx on public.crm_listing_matches(workspace_id, enquiry_id);
create unique index if not exists crm_listing_matches_commercial_unique on public.crm_listing_matches(workspace_id,enquiry_id,commercial_listing_id) where commercial_listing_id is not null;
create unique index if not exists crm_listing_matches_reference_unique on public.crm_listing_matches(workspace_id,enquiry_id,listing_reference) where commercial_listing_id is null and listing_reference <> '';
create index if not exists crm_enquiry_stage_history_timeline_idx on public.crm_enquiry_stage_history(workspace_id, enquiry_id, created_at desc);
create index if not exists crm_deal_stage_history_timeline_idx on public.crm_deal_stage_history(workspace_id, deal_id, created_at desc);

create or replace function public.crm_stage_transition_allowed(from_stage text, to_stage text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select from_stage = to_stage or case from_stage
    when 'NEW_ENQUIRY' then to_stage in ('CONTACTED','LOST')
    when 'CONTACTED' then to_stage in ('QUALIFIED','LOST')
    when 'QUALIFIED' then to_stage in ('MATCHED','VIEWING_SCHEDULED','LOST')
    when 'MATCHED' then to_stage in ('VIEWING_SCHEDULED','NEGOTIATION','LOST')
    when 'VIEWING_SCHEDULED' then to_stage in ('VIEWING_COMPLETED','LOST')
    when 'VIEWING_COMPLETED' then to_stage in ('FOLLOW_UP','NEGOTIATION','LOST')
    when 'FOLLOW_UP' then to_stage in ('MATCHED','VIEWING_SCHEDULED','NEGOTIATION','LOST')
    when 'NEGOTIATION' then to_stage in ('BOOKING','LOST')
    when 'BOOKING' then to_stage in ('LEGAL','HANDOVER','LOST')
    when 'LEGAL' then to_stage in ('HANDOVER','LOST')
    when 'HANDOVER' then to_stage in ('CLOSED','LOST')
    when 'CLOSED' then to_stage = 'AFTER_SALES'
    else false
  end
$$;

create or replace function public.crm_record_stage_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if tg_table_name = 'crm_enquiries' then
      insert into public.crm_enquiry_stage_history(workspace_id,enquiry_id,from_stage,to_stage,changed_by)
      values (new.workspace_id,new.id,null,new.stage,auth.uid());
    else
      insert into public.crm_deal_stage_history(workspace_id,deal_id,from_stage,to_stage,changed_by)
      values (new.workspace_id,new.id,null,new.stage,auth.uid());
    end if;
  elsif old.stage is distinct from new.stage then
    if not public.crm_stage_transition_allowed(old.stage,new.stage) then
      raise exception 'invalid CRM stage transition from % to %', old.stage, new.stage using errcode = '23514';
    end if;
    if tg_table_name = 'crm_enquiries' then
      insert into public.crm_enquiry_stage_history(workspace_id,enquiry_id,from_stage,to_stage,changed_by)
      values (new.workspace_id,new.id,old.stage,new.stage,auth.uid());
    else
      insert into public.crm_deal_stage_history(workspace_id,deal_id,from_stage,to_stage,changed_by)
      values (new.workspace_id,new.id,old.stage,new.stage,auth.uid());
    end if;
  end if;
  return new;
end
$$;

create or replace function public.crm_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists crm_enquiry_stage_history_trigger on public.crm_enquiries;
create trigger crm_enquiry_stage_history_trigger after insert or update of stage on public.crm_enquiries
for each row execute function public.crm_record_stage_change();
drop trigger if exists crm_deal_stage_history_trigger on public.crm_deals;
create trigger crm_deal_stage_history_trigger after insert or update of stage on public.crm_deals
for each row execute function public.crm_record_stage_change();

do $$
declare table_name text;
begin
  foreach table_name in array array['crm_enquiries','crm_deals','crm_appointments','crm_follow_ups','crm_listing_matches'] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_touch_updated_at', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.crm_touch_updated_at()', table_name || '_touch_updated_at', table_name);
  end loop;
end $$;

alter table public.crm_enquiries enable row level security;
alter table public.crm_deals enable row level security;
alter table public.crm_appointments enable row level security;
alter table public.crm_follow_ups enable row level security;
alter table public.crm_listing_matches enable row level security;
alter table public.crm_enquiry_stage_history enable row level security;
alter table public.crm_deal_stage_history enable row level security;

drop policy if exists "contacts workspace select" on public.contacts;
drop policy if exists "contacts workspace write" on public.contacts;
drop policy if exists "contacts workspace insert" on public.contacts;
drop policy if exists "contacts workspace update" on public.contacts;
drop policy if exists "contacts workspace delete" on public.contacts;
create policy "contacts workspace select" on public.contacts for select to authenticated
using (public.has_workspace_role(workspace_id, array['owner','admin','manager','agent','finance','viewer']));
create policy "contacts workspace insert" on public.contacts for insert to authenticated
with check (public.has_workspace_role(workspace_id, array['owner','admin','manager','agent']));
create policy "contacts workspace update" on public.contacts for update to authenticated
using (public.has_workspace_role(workspace_id, array['owner','admin','manager','agent']))
with check (public.has_workspace_role(workspace_id, array['owner','admin','manager','agent']));
create policy "contacts workspace delete" on public.contacts for delete to authenticated
using (public.has_workspace_role(workspace_id, array['owner','admin']));

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'crm_enquiries','crm_deals','crm_appointments','crm_follow_ups','crm_listing_matches',
    'crm_enquiry_stage_history','crm_deal_stage_history'
  ] loop
    execute format('drop policy if exists "%s workspace read" on public.%I', table_name, table_name);
    execute format(
      'create policy "%s workspace read" on public.%I for select to authenticated using (public.has_workspace_role(workspace_id, array[''owner'',''admin'',''manager'',''agent'',''finance'',''viewer'']))',
      table_name, table_name
    );
  end loop;

  foreach table_name in array array['crm_enquiries','crm_deals','crm_appointments','crm_follow_ups','crm_listing_matches'] loop
    execute format('drop policy if exists "%s workspace insert" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%s workspace update" on public.%I', table_name, table_name);
    execute format('drop policy if exists "%s workspace delete" on public.%I', table_name, table_name);
    execute format(
      'create policy "%s workspace insert" on public.%I for insert to authenticated with check (
        public.has_workspace_role(workspace_id, array[''owner'',''admin''])
        or (public.has_workspace_role(workspace_id, array[''agent'']) and assigned_user_id = auth.uid())
      )', table_name, table_name
    );
    execute format(
      'create policy "%s workspace update" on public.%I for update to authenticated using (
        public.has_workspace_role(workspace_id, array[''owner'',''admin''])
        or (public.has_workspace_role(workspace_id, array[''agent'']) and assigned_user_id = auth.uid())
      ) with check (
        public.has_workspace_role(workspace_id, array[''owner'',''admin''])
        or (public.has_workspace_role(workspace_id, array[''agent'']) and assigned_user_id = auth.uid())
      )', table_name, table_name
    );
    execute format(
      'create policy "%s workspace delete" on public.%I for delete to authenticated using (
        public.has_workspace_role(workspace_id, array[''owner'',''admin''])
      )', table_name, table_name
    );
  end loop;
end $$;

create policy "crm enquiry history workspace insert" on public.crm_enquiry_stage_history
for insert to authenticated with check (
  public.has_workspace_role(workspace_id, array['owner','admin'])
  or public.has_workspace_role(workspace_id, array['agent'])
);
create policy "crm deal history workspace insert" on public.crm_deal_stage_history
for insert to authenticated with check (
  public.has_workspace_role(workspace_id, array['owner','admin'])
  or public.has_workspace_role(workspace_id, array['agent'])
);

revoke all on public.crm_enquiries, public.crm_deals, public.crm_appointments, public.crm_follow_ups,
  public.crm_listing_matches, public.crm_enquiry_stage_history, public.crm_deal_stage_history from anon, public;
grant select, insert, update, delete on public.crm_enquiries, public.crm_deals, public.crm_appointments,
  public.crm_follow_ups, public.crm_listing_matches to authenticated;
grant select, insert on public.crm_enquiry_stage_history, public.crm_deal_stage_history to authenticated;
revoke all on function public.crm_stage_transition_allowed(text,text) from public, anon;
grant execute on function public.crm_stage_transition_allowed(text,text) to authenticated;

notify pgrst, 'reload schema';
