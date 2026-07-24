-- Phase 1 WhatsApp integration. Additive only: extends the existing, RLS-protected
-- contact_communications table (see 20260717193513_contact_management_and_collection_routing.sql)
-- with the metadata needed to log manual WhatsApp outreach. No message body is stored by
-- default; only template type, language, status, and a content hash are recorded.

alter table public.contact_communications
  add column if not exists template_type text not null default '';

alter table public.contact_communications
  add column if not exists language text not null default 'en'
    check (language in ('en', 'zh', 'bilingual'));

alter table public.contact_communications
  add column if not exists status text not null default 'prepared'
    check (status in ('prepared', 'sent_manually', 'no_answer', 'replied', 'payment_promised', 'follow_up_required', 'wrong_number'));

alter table public.contact_communications
  add column if not exists follow_up_date date;

alter table public.contact_communications
  add column if not exists note text not null default '';

create index if not exists contact_communications_workspace_followup_idx
  on public.contact_communications (workspace_id, follow_up_date)
  where follow_up_date is not null;

notify pgrst, 'reload schema';
