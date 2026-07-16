-- NON-DESTRUCTIVE SPRINT 008 EMERGENCY LOCKDOWN
-- Use only if onboarding/invitation behavior must be stopped after migration.
-- This preserves all workspaces, memberships, invitations, and audit records.

begin;

revoke all on function public.provision_workspace(text, text, text, text, text, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.create_workspace_invitation(uuid, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.accept_workspace_invitation(text)
  from public, anon, authenticated;

commit;

-- Then manually roll the Vercel deployment back to the last known-good build.
-- Do not drop Sprint 008 tables or columns after customer onboarding has begun.
-- A destructive schema rollback requires a reviewed, data-aware migration.
