-- Sprint 004: Workspace branding fields and notification infrastructure.
-- Idempotent. All columns added with IF NOT EXISTS.

-- Extend workspaces with branding / contact settings not in Sprint 008.
alter table public.workspaces
  add column if not exists logo_url          text,
  add column if not exists ren_number        text not null default '',
  add column if not exists email_from_name   text not null default '',
  add column if not exists email_from_address text not null default '',
  add column if not exists whatsapp_default_number text not null default '';

-- Persistent notification inbox for in-app bell.
create table if not exists public.notifications (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references public.workspaces(id) on delete cascade,
  type         text        not null check (type in ('renewal','outstanding','document_upload','crm_reminder','collection_reminder','system')),
  title        text        not null,
  body         text        not null default '',
  entity_type  text,
  entity_id    uuid,
  is_read      boolean     not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_workspace_unread_idx
  on public.notifications (workspace_id, is_read, created_at desc);

alter table public.notifications enable row level security;
revoke all on public.notifications from public, anon;
grant select, insert, update on public.notifications to authenticated;

drop policy if exists "workspace members read notifications" on public.notifications;
create policy "workspace members read notifications"
  on public.notifications for select to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members insert notifications" on public.notifications;
create policy "workspace members insert notifications"
  on public.notifications for insert to authenticated
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "workspace members update notifications" on public.notifications;
create policy "workspace members update notifications"
  on public.notifications for update to authenticated
  using (public.is_workspace_member(workspace_id));
