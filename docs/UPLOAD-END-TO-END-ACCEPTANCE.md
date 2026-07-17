# Upload end-to-end acceptance

## Preconditions

1. Apply `supabase/migrations/202607171300_upload_end_to_end_persistence.sql`, followed by `supabase/migrations/202607171315_upload_end_to_end_tenant_company_compatibility.sql` and `supabase/migrations/202607171330_upload_end_to_end_security_invoker.sql`, using the approved production Supabase migration process.
2. Confirm the SQL verification queries below return the expected results.
3. Merge the reviewed branch into `main` and wait for the Vercel production deployment to be Ready. Do not run a manual deployment.
4. Use two verified user accounts in different active workspaces. Use test tenancy agreements only; do not use customer documents.

## Database verification

Run this read-only query after the migration:

```sql
select
  to_regprocedure('public.upload_end_to_end_import_tenancy(uuid,jsonb)') as import_rpc,
  to_regprocedure('public.upload_end_to_end_preserve_failed_upload(uuid,jsonb)') as failed_upload_rpc,
  has_function_privilege('authenticated', 'public.upload_end_to_end_import_tenancy(uuid,jsonb)', 'execute') as import_granted,
  has_function_privilege('anon', 'public.upload_end_to_end_import_tenancy(uuid,jsonb)', 'execute') as anon_blocked_expect_false;

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'documents', 'document_extractions', 'tenancies', 'tenancy_documents',
    'tenancy_extractions', 'tenancy_legal_analyses',
    'tenancy_legal_clauses', 'tenancy_legal_risks'
  )
order by c.relname;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'documents_workspace_document_hash_unique',
    'tenancies_workspace_tenant_property_unit_unique'
  )
order by indexname;
```

Expected: both RPC fields are non-null, `import_granted` is true, `anon_blocked_expect_false` is false, every listed table reports RLS enabled, and both indexes exist.

## Primary acceptance flow

1. Sign in as a workspace owner and open Rental Command Centre.
2. Upload a multi-page PDF agreement. Confirm that the review screen renders and that tenant, landlord, address, monthly rental, deposits, and available dates are populated from the full document.
3. Confirm the import. Inspect the JSON response in the browser network panel: it must include `success: true`, non-empty `requestId`, `documentId`, `extractionId`, `tenancyId`, `warnings`, and `data`.
4. Confirm Monthly Rental, Outstanding, Collected, and Overdue totals update without a browser reload.
5. Open the saved tenancy and open its document. Refresh the page and confirm the tenancy, document, extraction-derived fields, and first collection persist.
6. Upload the same file again and confirm the response is successful or reports the existing document without creating a second tenancy, document, extraction, collection, clause, or risk record.
7. Upload a TXT agreement and a DOCX agreement. Confirm both complete the same path.
8. Upload a scanned PDF. Confirm OCR is attempted, the response remains JSON, and an unreadable document is preserved with a retryable failure rather than a plain-text or HTML response.
9. Force a legal-analysis persistence warning with a non-production test fixture if available. Confirm the base tenancy, document, extraction, and collection are retained and the response includes a warning.
10. Sign in as the second-workspace user. Confirm no first-workspace tenancy, document, extraction, collection, clause, or risk is visible or retrievable by altered identifier.

## Error and diagnostics checks

1. Upload an unsupported file and an oversized file. Each response must be JSON with `success: false`, `requestId`, `stage`, `code`, `error`, and `details`.
2. Temporarily use a test account with no active workspace. Confirm `stage` is `auth` and no storage or database row is created.
3. On a database failure, confirm `stage` is `database` and `details.postgrestCode` contains the actual PostgREST error code. `PGRST202` must not appear after the migration.
4. Search Vercel runtime logs by `requestId`. Confirm logs include file type/size, text length, OpenAI/provider result, RPC name, PostgREST status/code, and timings, but no agreement text or contact data.

## Completion criteria

The pipeline is accepted only when all primary-flow and error checks pass in production, no `PGRST202` appears in Vercel or Supabase API logs, duplicate retry produces one record set, and the second workspace cannot read the first workspace’s records.
