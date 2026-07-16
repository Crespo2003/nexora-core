# Sprint 008 — Multi-tenant SaaS onboarding

## Architecture

- `/signup` uses Supabase email/password signup. It supplies display-only profile metadata and an `/auth/callback` confirmation URL. It never creates an anonymous user.
- `/auth/callback` exchanges the one-time PKCE code, requires a confirmed email, validates the local `next` path, and routes by membership count.
- `/onboarding/workspace` calls an authenticated server route. The route validates the session and invokes `provision_workspace`; the database derives the owner from `auth.uid()`.
- `provision_workspace` serializes each user/idempotency-key pair and creates the workspace, Owner membership, onboarding-attempt completion, and activity log in one transaction.
- The `nexora_active_workspace` cookie is HTTP-only, SameSite=Lax, and Secure in production. It is only a hint: every API request revalidates the cookie value against the authenticated user's active membership.
- Existing `workspace_members` data is retained for backward compatibility. It is the membership entity used by the application and continues to support many workspaces per user.
- Workspace invitations store only a SHA-256 token hash. Tokens expire, acceptance requires the authenticated verified email to match, duplicate pending invitations are blocked, and Owner invitations are not supported.

## Required Vercel environment variables

Set these independently for Development, Preview, and Production as appropriate:

- `NEXT_PUBLIC_SUPABASE_URL`: project URL; public configuration, not a secret.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: public/publishable browser key. Never use a privileged database key here.
- `NEXT_PUBLIC_SITE_URL`: canonical production origin: `https://nexora-v1-drab.vercel.app`; local value: `http://localhost:3000`.

No privileged Supabase credential is required by onboarding and none may be added to a `NEXT_PUBLIC_` variable.

## Supabase Auth URL configuration

Configure these manually in Supabase Auth → URL Configuration. Do not change them through a deployment script.

- Site URL: `https://nexora-v1-drab.vercel.app`.
- Exact production confirmation callback: `https://nexora-v1-drab.vercel.app/auth/callback`.
- Exact production password reset callback: `https://nexora-v1-drab.vercel.app/reset-password`.
- Local callbacks: `http://localhost:3000/auth/callback` and `http://localhost:3000/reset-password`.
- Vercel preview callbacks: `https://*-ryanchlee-6420s-projects.vercel.app/auth/callback` and `https://*-ryanchlee-6420s-projects.vercel.app/reset-password`.

Use exact production paths. Restrict preview wildcards to the Vercel team/account slug. In the confirmation email template, use the redirect target/token-hash pattern recommended by Supabase so the request returns through `/auth/callback`.

## Routing outcomes

- Confirmed user, no membership → `/onboarding/workspace`.
- One active workspace → active workspace dashboard.
- More than one active workspace → `/workspace/select` until a validated workspace is selected.
- Only suspended/disabled membership or suspended workspace → `/access-denied`.
- Manipulated or stale workspace cookie → selector or access denial; APIs reject it.

## Invitation delivery foundation

`POST /api/workspace-invitations` returns an `acceptPath` for the authorized Owner/Admin caller. This is intentionally a delivery-neutral foundation. An email provider may later deliver that path, but logs must never record the raw token. `POST /api/workspace-invitations/accept` accepts the token after authentication and matching-email verification.

## Manual acceptance test summary

- [ ] Open the production `/signup` page.
- [ ] Register a brand-new user with terms accepted.
- [ ] Verify the email.
- [ ] Confirm the link returns through `/auth/callback` without an external redirect.
- [ ] Create a workspace at `/onboarding/workspace`.
- [ ] Confirm exactly one active Owner membership exists for that user/workspace.
- [ ] Enter the dashboard and confirm the active workspace cookie is HTTP-only.
- [ ] Log out, log back in, and confirm the workspace persists.
- [ ] Register and verify a second user.
- [ ] As the first Owner, create an invitation for the second user's exact email.
- [ ] Sign in as the second user and accept the invitation.
- [ ] Confirm the second user sees only the invited workspace and no records from another workspace.
- [ ] As the first user, create a second workspace.
- [ ] Confirm `/workspace/select` appears and switching validates both memberships.
- [ ] Manipulate the active-workspace cookie/ID and confirm API access is denied.
- [ ] Confirm cross-workspace table reads, writes, storage paths, and route IDs are denied.
- [ ] Confirm the old “Create First Admin” customer UI no longer appears.
- [ ] Confirm signup and onboarding never report an anonymous-auth error.
- [ ] Confirm expired, revoked, duplicate, and wrong-email invitations are rejected.
- [ ] Confirm the final active Owner cannot be deleted or demoted.
- [ ] Review Vercel runtime logs and confirm no onboarding-related 4xx/5xx remains unexplained.

## Authoritative 22-step live acceptance test

1. [ ] Open `https://nexora-v1-drab.vercel.app/signup`, register disposable user A, accept the terms, and record the email.
2. [ ] Open user A's verification email. Confirm the browser returns through `https://nexora-v1-drab.vercel.app/auth/callback` and does not leave the Nexora origin.
3. [ ] Confirm the callback sends user A to `/onboarding/workspace`.
4. [ ] Create Workspace A and record its returned/selected workspace ID.
5. [ ] In Supabase, verify exactly one `workspace_members` row exists for user A and Workspace A with `role = 'owner'` and `status = 'active'`.
6. [ ] Log out, sign in again as user A, and confirm Workspace A and its dashboard persist.
7. [ ] In a separate browser profile, register and verify disposable user B.
8. [ ] As user A in Workspace A, call `POST /api/workspace-invitations` with user B's exact email and `role: "agent"`; record the returned `acceptPath` without logging or sharing its raw invitation value.
9. [ ] Sign in as user B, open the recorded `acceptPath`, accept it, and verify one active Agent membership is created in Workspace A.
10. [ ] As user B, confirm Workspace A is visible and no other workspace or business record is returned by pages, APIs, direct table reads, or storage paths.
11. [ ] As user A, open `/onboarding/workspace` and create Workspace B.
12. [ ] Sign in again as user A and confirm `/workspace/select` appears with only Workspace A and Workspace B.
13. [ ] Switch A → B → A; confirm the HTTP-only `nexora_active_workspace` cookie changes and every API response belongs to the selected workspace.
14. [ ] Replay the exact Workspace B provisioning request with the same `idempotencyKey`; expect the same workspace ID with `idempotentReplay: true`, and verify no second workspace/membership/log set was created.
15. [ ] Send `POST /api/workspaces/active` with a random or another user's workspace UUID; expect HTTP 403 and no active-workspace change.
16. [ ] As user B, attempt to update their membership role from Agent to Owner through the Data API; expect RLS/permission denial and verify the stored role remains `agent`.
17. [ ] Attempt to delete or demote Workspace A's only active Owner; expect `final_owner_required` and verify the Owner membership remains active.
18. [ ] With user A on Workspace B, query known Workspace A table IDs and storage paths; expect empty results or HTTP 403/404, never Workspace A data.
19. [ ] Visit `/login`, `/signup`, and legacy `/setup`; confirm “Create First Admin” is absent and `/setup` redirects to the new flow.
20. [ ] Search the deployed build and repository onboarding code for `signInAnonymously`; expect zero runtime-code matches and confirm anonymous users remain disabled in Supabase Auth.
21. [ ] Test an expired invitation, wrong-email acceptance, and duplicate pending invitation; expect `invitation-expired`, `invitation-email-mismatch`, and `active-invitation-exists` respectively.
22. [ ] In Vercel Runtime Logs, filter Production and the acceptance-test time window for `/signup`, `/auth/callback`, `/onboarding/workspace`, `/api/workspaces/*`, and `/api/workspace-invitations*`; confirm no unexplained 4xx and no 5xx errors.

## Deployment order

1. Run `docs/sql/SPRINT-008-PREFLIGHT.sql` and save its counts.
2. In the `nexora-core-db` SQL Editor, wrap the complete contents of `20260716101934_sprint_008_multitenant_saas_onboarding.sql` in `begin;` and `commit;`, then run the whole query once. The connected project already contains the Sprint 007 hardening objects, so do not re-run that migration there.
3. Run `docs/sql/SPRINT-008-POST-VALIDATION.sql`; all expected checks must pass and pre-acceptance counts must be unchanged.
4. Re-run Supabase Security Advisor. The legacy bootstrap warning must disappear; review any warning for the three intentionally authenticated, tightly scoped Sprint 008 RPCs.
5. Configure the production/preview/local Auth URLs above.
6. Configure the three public environment values.
7. Deploy the application only after the migration is confirmed.
8. Execute the manual acceptance checklist with disposable users and two isolated workspaces.

If the SQL Editor reports an error before `commit`, run `rollback;`, capture the complete error, and do not retry piecemeal. If a post-deployment security issue appears, run `docs/sql/SPRINT-008-EMERGENCY-LOCKDOWN.sql` and manually roll Vercel back; retain the additive database objects and customer data.

No production setting, migration, deployment, or invitation email is applied automatically by this sprint.
