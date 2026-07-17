# Sprint 011 — AI Legal Engine Live Acceptance

Run this checklist against a preview deployment before promoting it. Use real agreements whose expected values have been reviewed by a person. Do not upload personal agreements unless the workspace is approved for that data.

## Prerequisites

- Apply these migrations to the target Supabase project in order:
  1. `20260716232802_sprint_009_ai_legal_engine.sql`
  2. `202607170001_sprint_010_ai_legal_intelligence.sql`
  3. `202607170200_sprint_011_ai_legal_stabilization.sql`
- Configure `OPENAI_API_KEY` as a server-only Vercel variable for Preview and Production.
- Configure `OPENAI_OCR_MODEL` for Preview and Production, or accept the server default `gpt-4.1-mini`.
- Configure `OPENAI_TENANCY_MODEL` for Preview and Production, or accept the server default `gpt-5.5`.
- Confirm that none of these variables uses the `NEXT_PUBLIC_` prefix.
- Prepare one reviewed agreement for each required case: digital PDF, scanned PDF, DOCX, TXT, English, Chinese, and mixed English/Chinese.

## Acceptance procedure

1. Sign in as an Owner, Admin, Manager, or Agent and select Workspace A.
2. Open Rental Command Centre and record the current Monthly Rental, Outstanding, Collected, and Overdue totals.
3. Upload a real digital Malaysian tenancy PDF. Confirm the upload completes and the source document is retained in the `real-estate-documents` bucket.
4. In the upload response, confirm `extraction.document.model` equals the configured `OPENAI_TENANCY_MODEL`, or `gpt-5.5` when the variable is absent. Confirm `advancedAiConfigured` is `true`; otherwise the deterministic fallback ran.
5. Confirm the original document has all pages by comparing `extraction.document.pageCount`, `--- PAGE N ---` markers in `rawText`, and the source PDF.
6. Review every populated form value against the source agreement, including parties, company/identity details, property, areas, parking, rent, deposits, dates, notice, utilities, witnesses, stamp duty, inventory, late payment, termination, viewing, maintenance, insurance, and special clauses.
7. For each populated value, inspect `legalIntelligence.field_evidence.<field>` in the upload response. Confirm `value`, `confidence`, `source_page`, and `source_excerpt` match the agreement. Empty values must have confidence `0` and no source reference.
8. Confirm every field below `80` is shown with a low/medium-confidence review indication beside the existing form field.
9. Review every risk. Confirm it contains `severity`, `category`, `reason`, `recommendation`, `source_page`, and `source_excerpt`. Missing-clause risks may have no source reference. Confirm wording identifies a review concern and does not assert an unsupported legal conclusion.
10. Change exactly one populated field in the review form and leave all other fields unchanged. Do not upload the file again.
11. Confirm the import. Confirm one tenancy, one initial rental collection, the linked original document, extraction data, and audit activities are created.
12. Without reloading the browser page, confirm Monthly Rental, Outstanding, Collected, and Overdue update to include the imported tenancy.
13. Reload the page. Confirm the corrected value and all other reviewed values persist.
14. Verify persistence with the validation SQL below. Confirm raw text, structured JSON, source references, summary, risks, confidence, user correction, final tenancy values, and audit history are present.
15. Upload the same file again in Workspace A. Confirm the API returns `duplicate-document`, provides the existing document ID, and creates no new document or tenancy.
16. Upload a deliberately damaged copy only in a disposable test workspace. Confirm the original upload is preserved as `extraction_failed`, a bilingual actionable error is returned, and a retry is available in Document Centre.
17. Retry the failed document. Confirm the existing document and extraction are updated and no duplicate document, extraction, tenancy, or collection is created.
18. Repeat steps 3–9 for a real scanned PDF, DOCX, TXT, Chinese agreement, and mixed English/Chinese agreement.
19. Switch to Workspace B. Confirm Workspace A's document, extraction, tenancy, collection, source references, corrections, and audit history are not visible.
20. Attempt the document and tenancy APIs without a session and with a Workspace A record ID while active in Workspace B. Confirm access is denied and no record changes.

## Validation SQL

Run with the imported tenancy ID and document ID in Supabase SQL Editor. This is read-only.

```sql
select
  t.id,
  t.workspace_id,
  t.tenant,
  t.landlord,
  t.property,
  t.monthly_rental,
  t.commencement_date,
  t.expiry_date,
  te.raw_text <> '' as has_raw_text,
  te.extracted_json <> '{}'::jsonb as has_structured_json,
  te.field_confidence <> '{}'::jsonb as has_field_confidence,
  te.source_references <> '{}'::jsonb as has_source_references,
  te.ai_summary <> '' as has_summary,
  jsonb_array_length(te.risk_analysis) as risk_count,
  te.user_corrections,
  te.ai_model,
  te.extraction_engine
from public.tenancies t
join public.tenancy_documents td on td.tenancy_id = t.id and td.workspace_id = t.workspace_id
join public.tenancy_extractions te on te.tenancy_document_id = td.id and te.workspace_id = t.workspace_id
where t.id = '<TENANCY_ID>'::uuid;

select id, document_hash, processing_status, linked_status, storage_path
from public.documents
where id = '<DOCUMENT_ID>'::uuid;

select activity_type, activity_json, created_at
from public.activity_logs
where entity_type = 'tenancy' and entity_id = '<TENANCY_ID>'
order by created_at;
```

## Measured accuracy run

Create a local JSON ground-truth manifest for the real agreements; do not commit personal documents or expected personal data. Each entry must contain `id`, `path`, `mimeType`, `format`, `language`, and an `expected` map keyed by extraction path. Then run:

```powershell
$env:LIVE_AI_LEGAL='1'
$env:SPRINT011_GROUND_TRUTH_PATH='C:\secure-test-data\sprint011-ground-truth.json'
pnpm test
```

The live test fails unless all four formats and all three language groups are present. It calculates accuracy from the reviewed ground truth and requires at least 95%; no accuracy claim is valid without this run.
