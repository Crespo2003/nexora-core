# Nexora Sprint 004 Production Deployment Checklist

## Release Boundary

- Deploy only Sprint 004. Do not start Sprint 005.
- Take a database backup and record the current Vercel production deployment before applying migrations.
- Apply migrations before deploying the application.

## Migration Order

Apply every missing migration in this exact order:

1. `202607120004_sprint_001_production_ai_intake.sql`
2. `202607130001_fix_sprint_001_collection_schema.sql`
3. `202607130002_sprint_002_ai_document_centre.sql`
4. `202607131030_sprint_003_smart_collection_utility.sql`
5. `202607131145_sprint_003_live_collection_hardening.sql`
6. `202607131400_sprint_004_auth_workspace_security.sql`
7. `202607131600_sprint_004_remove_legacy_permissive_policies.sql`
8. `202607131620_sprint_004_security_advisor_hardening.sql`
9. `202607131640_sprint_004_final_advisor_hardening.sql`
10. `202607140033_sprint_004_secure_legacy_tables.sql`
11. `202607140047_sprint_004_legacy_grant_hardening.sql`

Do not rerun or reorder migrations already recorded in `supabase_migrations.schema_migrations`.

Verify:

- All eleven versions appear in migration history in ascending order.
- `public.sprint_004_system_check()` returns `migration.applied = true` for an owner or admin.
- Every Sprint business table has RLS enabled and workspace policies.
- No policy with a legacy beta or authenticated-all name remains.

## Authentication

1. Enable Supabase Email/Password authentication.
2. Configure the production Site URL and allowed redirect URLs.
3. Configure a production SMTP provider and test confirmation, password reset, and recovery delivery.
4. Create the first user through the supported auth flow.
5. Sign in and complete `/setup` once to atomically create the first workspace and owner membership.
6. Confirm a second user cannot reopen first-workspace setup.

Never expose a service-role key to the application or browser.

## Legacy Table Mapping

`properties` and `listing_memory` are retained legacy tables and are not referenced by the current application. The security migration preserves every row, enables RLS immediately, and quarantines rows without `workspace_id`.

Before migration, inspect without exposing record content:

```sql
select 'properties' as table_name, count(*) from public.properties
union all
select 'listing_memory', count(*) from public.listing_memory;
select id, workspace_id from public.properties where workspace_id is null;
select id, workspace_id from public.listing_memory where workspace_id is null;
```

If exactly one workspace exists, the migration maps null records automatically. Otherwise, map each record only after confirming its owner:

```sql
update public.properties set workspace_id = '<verified-workspace-uuid>' where id = '<record-uuid>';
update public.listing_memory set workspace_id = '<verified-workspace-uuid>' where id = '<record-uuid>';
alter table public.properties validate constraint properties_workspace_required;
alter table public.listing_memory validate constraint listing_memory_workspace_required;
```

Then verify RLS, four role-aware policies per table, no grants to `anon`, and zero null `workspace_id` values. Test owner, agent, finance, and viewer through authenticated clients. Anonymous selects must return no rows and anonymous writes must fail.

Rollback uses the pre-migration backup. Prefer a forward corrective migration; do not drop `workspace_id` or disable RLS while the application is live.

## Environment Variables

Required in Vercel Preview and Production:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Development/test only variables are documented in `.env.example`. Do not configure disposable E2E identities in production.

## Storage

Required active bucket:

- `real-estate-documents`: private, 10 MiB maximum, PDF/DOCX/JPEG/PNG allowlist.

Legacy private buckets may remain for old objects:

- `tenancy-documents`
- `utility-bills`

New tenancy documents and utility bills use workspace-prefixed paths in `real-estate-documents`. All reads use short-lived signed URLs. Owner/admin may delete; manager/agent/finance/viewer cannot delete. Finance uploads are restricted to the workspace `utility-bills` folder. Every role is blocked from another workspace.

## Role Matrix

| Capability | Owner | Admin | Manager | Agent | Finance | Viewer |
| --- | --- | --- | --- | --- | --- | --- |
| Read own workspace business data | Yes | Yes | Yes | Yes | Yes | Yes |
| Edit tenancies/documents/utilities/follow-ups | Yes | Yes | Yes | Yes | No | No |
| Edit collections/payments/adjustments | Yes | Yes | Yes | No | Yes | No |
| Manage non-owner members | Yes | Yes | No | No | No | No |
| Manage owner memberships | Yes | No | No | No | No | No |
| Delete business records | Yes | Yes | No | No | No | No |
| Upload general documents | Yes | Yes | Yes | Yes | No | No |
| Upload utility bills | Yes | Yes | Yes | Yes | Yes | No |
| Delete stored files | Yes | Yes | No | No | No | No |
| Run system check | Yes | Yes | No | No | No | No |

Activity logs are immutable. Every permission is scoped to workspace membership.

## First Live Workflow

1. Sign in as the first owner and complete `/setup`.
2. Open `/admin/system-check` and confirm every check passes.
3. Create a real tenancy and its initial monthly collection.
4. Upload a valid tenancy agreement PDF, review extracted fields, and save.
5. Add a utility account.
6. Upload a real utility bill, review extraction, and confirm it.
7. Verify the monthly collection includes the confirmed utility amount.
8. Record a partial payment and verify paid/outstanding totals.
9. Record a reversal or refund and verify ledger-derived totals.
10. Generate a reminder and persist a follow-up action.
11. Refresh all affected pages and confirm every record remains.
12. Sign in with each role and confirm the matrix above.
13. Sign in to a second workspace and confirm records and files cannot cross workspaces.
14. Log out and confirm protected pages and APIs reject unauthenticated access.

## Vercel

1. Add required environment variables to Preview and Production.
2. Deploy the reviewed Sprint 004 branch without automatically merging.
3. Confirm login, redirects, API writes, private signed URLs, and mobile layouts on Preview.
4. Run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e`.
5. Promote only after Supabase advisors and the complete live workflow are reviewed.

## Rollback

1. Pause new writes and promote the previous Vercel deployment.
2. Prefer a forward corrective migration for schema-only defects.
3. Restore the pre-deployment database backup only for confirmed data corruption.
4. Preserve Storage objects unless the rollback plan explicitly accounts for database references.
5. Reverify auth, memberships, RLS, signed URLs, and system check before reopening writes.
6. Recover an admin by correcting `workspace_members` through the Supabase dashboard; never add a browser service-role key.
