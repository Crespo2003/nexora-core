# Sprint 007.6 authoritative state freeze

Captured on 2026-07-24. This document and the adjacent SQL files are planning
artifacts only. Nothing in this directory is an active migration.

## Git and Supabase

- Branch: `feature/upload-end-to-end`
- Local HEAD: `e8625642b5ab69a5cfac463394ab494a49e27ad5`
- Remote branch HEAD: `e8625642b5ab69a5cfac463394ab494a49e27ad5`
- Working tree before this package: clean
- Supabase project: `nexora-core-db`
- Project reference: `hejpweqwsizhlmevfkwr`
- Region: `ap-southeast-1`
- PostgreSQL: `17.6.1.141`
- Environment warning: this is the shared project, not an isolated migration
  rehearsal branch.

## Remote migration ledger

The live ledger contains 17 applied records:

| Remote version | Recorded name |
|---|---|
| `20260713155216` | `202607120004_sprint_001_production_ai_intake` |
| `20260713155217` | `202607130001_fix_sprint_001_collection_schema` |
| `20260713155219` | `202607130002_sprint_002_ai_document_centre` |
| `20260713155220` | `202607131030_sprint_003_smart_collection_utility` |
| `20260713155222` | `202607131145_sprint_003_live_collection_hardening` |
| `20260713155223` | `202607131400_sprint_004_auth_workspace_security` |
| `20260713155411` | `202607131600_sprint_004_remove_legacy_permissive_policies` |
| `20260713155540` | `202607131620_sprint_004_security_advisor_hardening` |
| `20260713161923` | `202607131640_sprint_004_final_advisor_hardening` |
| `20260713163707` | `202607140033_sprint_004_secure_legacy_tables` |
| `20260713163751` | `202607140047_sprint_004_legacy_grant_hardening` |
| `20260716145310` | `fix_sprint_008_provision_workspace_idempotency_ambiguity` |
| `20260716150146` | `fix_sprint_008_provision_workspace_conflict_target` |
| `20260717120548` | `upload_end_to_end_persistence` |
| `20260717120711` | `upload_end_to_end_tenant_company_compatibility` |
| `20260717120840` | `upload_end_to_end_security_invoker` |
| `20260720171124` | `sync_document_linked_status_with_active_tenancies` |

All 17 records must remain applied unless an approved forensic review proves a
ledger entry false. No such evidence exists today.

## Public schema summary

- 28 base/partitioned tables; RLS is enabled on all 28.
- Forced RLS is enabled on `listing_memory` and `properties`.
- 93 public-table policies.
- 122 public indexes.
- 55 public foreign keys.
- 21 distinct public triggers.
- 25 functions across `public`, `private`, and `app_private`.
- One private setup table, `setup_private.workspace_setup_state`, does not have
  RLS. It is outside the exposed `public` schema, but its grants and schema
  exposure must be confirmed before treating this as safe.

Public tables:

`activity_logs`, `collection_adjustments`, `collection_followups`,
`collection_payments`, `collection_reminders`, `document_activity`,
`document_extractions`, `document_links`, `documents`, `import_jobs`,
`listing_memory`, `onboarding_attempts`, `profiles`, `properties`,
`rental_collections`, `tenancies`, `tenancy_documents`,
`tenancy_extractions`, `tenancy_legal_analyses`,
`tenancy_legal_clause_categories`, `tenancy_legal_clauses`,
`tenancy_legal_risks`, `utility_account_history`, `utility_accounts`,
`utility_bills`, `workspace_invitations`, `workspace_members`, `workspaces`.

The `public.workspace_memberships` object is a view and must retain
`security_invoker` behavior or be unavailable to Data API roles.

## Requested-object inventory

| Object | Remote state | Important details |
|---|---|---|
| `workspaces` | Present | PK `id`; owner FK; business/country/timezone/currency/language profile columns; RLS |
| `workspace_members` | Present | PK `id`; workspace/user FKs; role/status checks; RLS |
| `contacts` | Absent | Required before Sprint 007 CRM |
| `companies` | Absent | No generic company entity |
| `commercial_companies` | Absent | Commercial migration not installed |
| `commercial_contacts` | Absent | Commercial migration not installed |
| `commercial_requirements` | Absent | Commercial migration not installed |
| `commercial_listings` | Absent | CRM must not require this FK until Commercial is installed |
| `commercial_deals` and related pipeline tables | Absent | Commercial migration not installed |
| tenancy tables | Present | `tenancies`, collections, documents and extractions present; see Sprint 005 gaps |
| document tables | Present | `documents`, links, activity, extractions and import jobs present |
| legal core | Present | analyses, categories, clauses and risks |
| legal comparison tables | Absent | `tenancy_agreement_comparisons` and findings missing |
| `clients` | Absent | Application already treats `contacts` as the client record |
| unprefixed `enquiries`, `appointments`, `follow_ups`, `deals` | Absent | Not the names used by current application code |
| `crm_enquiries` | Absent | Sprint 007 target |
| `crm_listing_matches` | Absent | Sprint 007 target |
| `crm_appointments` | Absent | Sprint 007 target |
| `crm_follow_ups` | Absent | Sprint 007 target |
| `crm_deals` | Absent | Sprint 007 target |
| CRM stage-history tables | Absent | Sprint 007 target |

The current application consistently reads and writes `contacts` and
`crm_*`. Creating parallel `clients` or unprefixed CRM tables would duplicate
identity and break the application contract.

## Relevant existing columns

### Workspace

- `workspaces`: `id`, `name`, `owner_user_id`, `status`, timestamps,
  `business_type`, `country`, `timezone`, `preferred_currency`,
  `preferred_language`, `company_registration_number`, `contact_number`.
- `workspace_members`: `id`, `workspace_id`, `user_id`, `role`, `status`,
  timestamps.

### Tenancy and documents

- `tenancies` contains the original party/property/financial fields, collection
  scheduling fields, `workspace_id`, and `tenant_company`.
- `rental_collections` contains payment totals/status/history and
  `workspace_id`.
- `documents` contains storage metadata, processing/link status,
  `document_hash`, and nullable `workspace_id`.
- `tenancy_documents`, `tenancy_extractions`, `document_activity`,
  `document_extractions`, and `document_links` are present and workspace
  scoped.

### Legal

- `tenancy_legal_analyses`: analysis/document/tenancy identity, extraction
  version, executive summary, provider/model/cost metadata, timestamps.
- `tenancy_legal_clause_categories`: workspace code/label.
- `tenancy_legal_clauses`: source, confidence, risk, responsibility,
  obligation and recommendation fields.
- `tenancy_legal_risks`: rule/severity/source and recommendation fields.

The exact type, nullability, default, primary-key, unique, foreign-key, index,
policy, trigger, function and grant definitions are reproducibly emitted by
`01_preflight_checks.sql`; that catalog output is the execution-time source of
truth.

## Security observations

- Every public table currently has RLS, but grants and RLS are separate.
- Several legacy tables still inherit broad `anon`/`authenticated` table
  privileges from old default privileges. Existing RLS is the row boundary.
- `public.recompute_document_linked_status(uuid)` is `SECURITY DEFINER` and
  executable by `PUBLIC`, `anon`, and `authenticated`.
- Three trigger helpers for document-link status are also executable by
  `PUBLIC`, `anon`, and `authenticated`.
- Any future CRM tables must use explicit grants because Supabase is moving
  new projects and eventually existing projects away from automatic Data API
  exposure.

No security concern above is silently changed by this package.

## Current data checks

Read-only checks returned:

- tenancy rows with null workspace: 0
- document rows with null workspace: 0
- rental collection rows with null workspace: 0
- invalid tenancy date ranges: 0
- duplicate non-empty workspace document hashes: 0
- document rows with missing workspace parent: 0
- stale document links with missing document parent: 0

These results are a point-in-time observation, not an execution guarantee.
They must be rerun immediately before every future phase.
