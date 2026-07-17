# Nexora technical handover

## Purpose

Nexora is a Next.js tenancy-management application with a Malaysian tenancy-agreement import flow. The active implementation lives on `feature/upload-end-to-end`; it is designed to be reviewed and merged into `main` only after the database migration in this branch has been applied and verified.

## Architecture

The Rental Command Centre uploads PDF, DOCX, or TXT documents to the private `real-estate-documents` Supabase Storage bucket. `app/api/tenancy-import/upload/route.ts` delegates to `lib/tenancy/tenancyUploadHandler.ts`, which validates the file signature and size, creates a SHA-256 document hash, stores the binary, and invokes `lib/ai/tenancyExtractor.ts`.

`lib/ai/extractTenancy.ts` reads the entire document, invokes OCR when necessary, chunks long source text, calls the OpenAI Responses API, validates the strict tenancy schema, and merges legal-risk analysis. `lib/ai/tenancyExtractionContract.ts` is the normalisation boundary for Responses API output. `lib/tenancy/parser.ts` remains the guarded deterministic fallback; low-confidence fragments are not mapped into live fields.

`lib/tenancy/mapTenancyExtractionToForm.ts` maps validated extraction fields into the existing Rental Command Centre form without changing its layout. The browser retains review control. On confirmation, `app/api/tenancy-import/confirm/route.ts` invokes one database RPC and reloads `loadRentalData`, so the dashboard totals and saved-tenancy list update without a page refresh.

## Upload and persistence flow

1. The browser posts the document to `/api/tenancy-import/upload`.
2. The server validates the signed-in user, active workspace, origin, file type, byte limit, and magic signature.
3. The file is stored privately and text/OCR/OpenAI extraction runs with request-scoped diagnostics.
4. The extracted form is reviewed in the existing UI. A failed extraction persists a retryable document/extraction record through `upload_end_to_end_preserve_failed_upload`.
5. The browser posts confirmed mapped fields to `/api/tenancy-import/confirm`.
6. `upload_end_to_end_import_tenancy(uuid, jsonb)` creates or reuses the canonical document by `(workspace_id, document_hash)`, writes the legacy document and extraction records used by the current UI, writes the tenancy and initial collection, links the document, and writes an audit event.
7. Legal-analysis rows are attempted only after the base records have succeeded. A legal-analysis failure returns a warning and does not roll back the document, extraction, tenancy, or collection.
8. The confirmation route returns JSON with `requestId`, `documentId`, `extractionId`, `tenancyId`, provider/model metadata, warnings, and a `data` object. Every route-originated error is JSON too.

## Database migration

Apply `supabase/migrations/202607171300_upload_end_to_end_persistence.sql`, `supabase/migrations/202607171315_upload_end_to_end_tenant_company_compatibility.sql`, and `supabase/migrations/202607171330_upload_end_to_end_security_invoker.sql` in order, exactly once, through the approved migration workflow before deploying the branch.

The migration is additive except for two compatibility corrections:

- It replaces the global tenancy uniqueness constraint with a workspace-scoped unique index. The former constraint made the same tenancy in different workspaces impossible.
- It replaces the `tenancy_documents` MIME check to include `text/plain`, matching the UI and upload route.

It creates the two active RPCs:

- `public.upload_end_to_end_preserve_failed_upload(uuid, jsonb)`
- `public.upload_end_to_end_import_tenancy(uuid, jsonb)`

The import RPC is `SECURITY INVOKER` with an empty search path, no `PUBLIC` or `anon` execute grant, and an explicit `auth.uid()` plus workspace-role check. RLS remains enabled on all base and legal-intelligence tables. The migration aligns the two collection-insert policies with the API route's existing agent role, retaining workspace-scoped checks for every insert.

The migration issues `NOTIFY pgrst, 'reload schema'`, which makes the new function signatures visible to PostgREST and removes the observed `PGRST202` condition.

For a safe transition, it also exposes `sprint_015_import_tenancy_legal_intelligence(uuid, jsonb)` as a tightly scoped compatibility wrapper over the new RPC. That allows the currently deployed confirmation route to resolve the missing function once the database migration is applied; the active branch calls the versioned RPC directly.

## Live production finding

On 2026-07-17, the connected project `hejpweqwsizhlmevfkwr` had the base tables and RLS policies, but did not expose these functions:

- `sprint_005_create_document_bundle(uuid, jsonb)`
- `sprint_009_import_tenancy_legal_intelligence(uuid, jsonb)`
- `sprint_011_import_tenancy_legal_intelligence(uuid, jsonb)`
- `sprint_015_import_tenancy_legal_intelligence(uuid, jsonb)`

The deployed confirmation route called the last function, so PostgREST correctly returned `PGRST202`. The active branch no longer calls that unavailable chain.

## Supabase schema used by the flow

Base records are in `documents`, `document_extractions`, `tenancies`, `tenancy_documents`, `tenancy_extractions`, `document_links`, `rental_collections`, `collection_payments`, and `activity_logs`. Legal records are in `tenancy_legal_analyses`, `tenancy_legal_clause_categories`, `tenancy_legal_clauses`, and `tenancy_legal_risks`.

The document hash is the idempotency key. The RPC obtains a transaction advisory lock for `(workspace_id, document_hash)`, checks the existing document link first, and returns that saved tenancy on a retry. It never reads or links rows outside the caller’s workspace.

## Environment variables

Required on Vercel and for local server execution:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `OPENAI_API_KEY`

Optional:

- `OPENAI_TENANCY_MODEL` (the current default is configured in `lib/ai/openAiConfig.ts`)
- `OPENAI_OCR_MODEL`

Do not add Supabase service-role credentials to browser-exposed variables. The app uses the authenticated user’s Supabase session and database-side authorisation.

## Vercel deployment

Vercel builds the production branch automatically after GitHub merge. This task does not manually deploy. After the migration has been applied, merge the reviewed branch, wait for the Vercel `main` deployment to become Ready, and run the acceptance checklist in `docs/UPLOAD-END-TO-END-ACCEPTANCE.md` against the deployed URL.

Runtime diagnostics use the `[tenancy-extraction]` prefix. They record request ID, route stage, workspace ID, role, file type/size, text length, provider/model status, RPC name, PostgREST code, and elapsed time. They do not record agreement text, emails, phone numbers, or API keys.

## Local verification

Run these from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

The unit tests cover multipart JSON responses, fallback safety, full-document AI chunking, persistence contract shape, missing-RPC regression protection, RLS declarations, idempotent hash handling, legal-warning isolation, form mapping, and dashboard refresh behavior.

## Debugging

For a confirmation failure, capture the response `requestId`, then search Vercel runtime logs for that value. The route logs the exact RPC name and PostgREST code without document contents. A `PGRST202` means the migration is missing or PostgREST has not reloaded its schema. Confirm the function signature with:

```sql
select to_regprocedure('public.upload_end_to_end_import_tenancy(uuid,jsonb)');
select has_function_privilege('authenticated', 'public.upload_end_to_end_import_tenancy(uuid,jsonb)', 'execute');
```

If the upload itself fails, inspect the returned `stage` (`auth`, `validation`, `storage`, `pdf`, `ocr`, `openai`, `parser`, `mapping`, or `database`) and `code`. Do not expose the raw agreement text in support tickets or logs.

## Branch strategy and current limitation

Keep one focused branch per reviewed change. This repair branch is `feature/upload-end-to-end`; do not merge it until the migration and acceptance test are complete. The connected production database must receive the migration before the deployed current-main code can complete the persistence step. That is the sole live prerequisite for the repaired route; no destructive data cleanup is required.
