# Sprint 006 Private-Beta Checklist

This checklist must be completed against the private-beta Supabase project before Sprint 006 is deployed. Record the tester, UTC timestamp, workspace IDs, and result for every step. Never paste access tokens or secret keys into the record.

## 1. Preconditions

- Confirm the deployment commit was reviewed from `feature/sprint-006-ai-commercial-crm`.
- Confirm the current production database backup and Vercel rollback deployment are available.
- Confirm Sprint 001 through Sprint 005 migrations are already present in `supabase_migrations.schema_migrations`.
- Confirm the `real-estate-documents` bucket remains private.
- Create two disposable test workspaces: Workspace A and Workspace B.
- Create owner, admin, manager, agent, finance, and viewer users in Workspace A, plus an owner in Workspace B.

## 2. Apply Migration

Run the repository migrations through the normal Supabase CLI or CI migration workflow. Sprint 006 must run after `202607140330_sprint_005_final_blocker_remediation.sql`:

```text
202607142130_sprint_006_ai_commercial_crm.sql
```

Do not paste the migration selectively into a live SQL editor. If the migration fails, stop and retain the complete error output before retrying.

## 3. Schema Verification SQL

Run in the Supabase SQL editor:

```sql
select table_name
from information_schema.tables
where table_schema = 'public' and table_name like 'commercial_%'
order by table_name;

select tablename, indexname
from pg_indexes
where schemaname = 'public' and tablename like 'commercial_%'
order by tablename, indexname;

select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace and conrelid::regclass::text like 'commercial_%'
order by table_name, conname;

select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace and relname like 'commercial_%'
order by relname;

select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public' and tablename like 'commercial_%'
order by tablename, policyname;

select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public' and table_name like 'commercial_%';

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'commercial-media';
```

Expected: all commercial tables exist, RLS is `true`, the anonymous grant query returns zero rows, and `commercial-media` is private with a 15 MB limit.

## 4. Role Matrix

Repeat the checks through the application while signed in as each role:

| Role | Expected |
| --- | --- |
| Owner | Full commercial workspace access and deletion rights |
| Admin | Full workspace management access |
| Manager | Create/update/assign CRM, listings, proposals, follow-ups, and deals |
| Agent | Create records and manage records assigned to that agent only |
| Finance | Read permitted records and update only deal financial fields |
| Viewer | Read-only normal records; no mutation or export |

For every denied action, verify HTTP 403 or an RLS denial and confirm no row changed.

## 5. Workspace Isolation

1. In Workspace A, create a company, contact, requirement, listing, match, deal, proposal, media record, and follow-up.
2. Sign in as the Workspace B owner.
3. Request each Workspace A record ID through its application URL and API endpoint.
4. Attempt to create a Workspace B contact referencing the Workspace A company ID.
5. Attempt to assign a Workspace B record to a Workspace A user ID.

Expected: no Workspace A payload is returned, and both cross-workspace writes fail without creating rows.

## 6. Confidential Listing

1. As an owner, create a highly confidential listing containing a distinctive exact address, owner name, contact, coordinates, notes, photo, and document.
2. Assign it to Agent A.
3. Verify the owner, manager, and Agent A can access the authorized full record.
4. As viewer, finance, and Agent B, open the listing and search for its general area.
5. Inspect the browser network response.

Expected limited payload: general area, property type, approximate size/price ranges, availability, confidentiality badge, suitability text, and assigned agent only. The response must not contain the distinctive address, owner identity, owner contact, coordinates, storage paths, media, documents, or notes.

## 7. Private Media

1. Upload a JPEG property photo, PNG floor plan, PDF brochure, and DOCX authority letter to a normal listing.
2. Verify progress, preview where supported, download, and deletion.
3. Confirm paths follow `{workspace-id}/commercial/{listing-id}/{random-id}.{extension}` and contain no original filename, address, or owner identity.
4. Confirm signed URLs expire after five minutes.
5. Attempt unsupported type, mismatched extension, invalid signature, file over 15 MB, cross-workspace media ID, and unassigned-agent upload.
6. Repeat signed access against the highly confidential listing as viewer and Agent B.

Expected: valid files persist in the private bucket; invalid and unauthorized requests fail; restricted media cannot be listed or signed; upload/view/download/delete activities are recorded.

## 8. CSV Import and Export

For companies, contacts, requirements, and listings:

1. Upload a CSV containing valid rows, an invalid row, an in-file duplicate, and an existing database duplicate.
2. Confirm source row numbers and download the error report.
3. Correct and re-upload the file.
4. Confirm the preview explicitly.
5. Verify valid rows persist and invalid rows do not.
6. Submit the same confirmed file again.
7. Include cells beginning with `=`, `+`, `-`, and `@`, then export.
8. Attempt import/export as viewer and cross-workspace relationship IDs as manager.

Expected: no overwrite, one completed import job, duplicate confirmation is rejected idempotently, formulas are prefixed safely, viewer export is denied, workspace IDs are server-derived, and `csv_import_completed` is logged.

## 9. Matching and Proposals

1. Create one exact match, one over-budget listing, one excluded-location listing, one prohibited-use listing, one inactive listing, and one listing missing size/budget.
2. Run matching and refresh.
3. Verify the exact match can reach 100, hard conflicts are unsuitable and capped at 25, critical missing data is capped below 50, and inactive listings are absent.
4. Generate an optional AI explanation and verify the deterministic score does not change.
5. Create a proposal, add up to five listings, reorder, save internal/client notes, and test English, Chinese, and bilingual WhatsApp text.
6. Print the browser proposal and inspect its network payload for confidential fields.

Expected: scores and explanations persist, no facts are invented, proposal fields are confidentiality-safe, and nothing is sent externally.

## 10. Deals and Follow-Ups

1. Convert a match to a deal.
2. Move through each permitted stage and refresh after each update.
3. Attempt a skipped stage, backward transition, and reopening a terminal deal.
4. Verify probability, next action, commission, target close date, loss reason, overdue indication, and activity timeline.
5. Verify finance can change permitted financial fields but cannot change stage or identity links.
6. Create data for every follow-up queue: overdue, today, this week, inactive 7/14 days, proposal feedback, viewing feedback, stalled negotiation, expiring requirement, and listing re-verification.
7. Complete, reschedule, add a note, assign a workspace user, and create call, WhatsApp-draft, and email-draft tasks.
8. Refresh and verify persistence.

Expected: invalid stages fail, valid changes are logged, all ten queues are populated correctly, and no message is sent automatically.

## 11. Vercel

Configure for Preview and Production:

- Required: `NEXT_PUBLIC_SUPABASE_URL`
- Required: `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Optional server-only: `OPENAI_API_KEY`
- Optional server-only: `OPENAI_OCR_MODEL`
- Optional server-only: `OPENAI_COMMERCIAL_MODEL`

Redeploy only after Supabase verification passes. Confirm no server-only value appears in browser source, network payloads, or client bundles.

## 12. Rollback

If private-beta verification fails, roll Vercel back to the previous deployment first. Do not drop commercial tables or storage objects while diagnosing. Preserve imported records and uploaded media. If access must be stopped immediately, revoke `authenticated` access to the affected commercial tables and remove the three `commercial media` storage policies, then restore them through a reviewed forward migration.
