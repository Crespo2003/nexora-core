# Sprint 007.6 safe migration remediation package

Status: **NON-EXECUTED / NO-GO**

These files are review drafts outside `supabase/migrations`. They do not change
the database and must not be copied into the active migration chain until all
gates in `06_rollback_plan.md` pass.

## Architecture decision

Choose **B: extend `contacts` for client use**.

Evidence:

- The live database has no `contacts`, `clients`, generic `companies`, or
  Commercial tables.
- Current tenancy-contact synchronization reads and writes `contacts`,
  `contact_roles`, and `tenancy_contacts`.
- Current CRM APIs expose `/api/crm/clients` but persist the client identity in
  `contacts`.
- Enquiries, appointments, deals, search, notifications, and dashboard code
  join `crm_*` rows to `contacts`.
- Commercial has separate, purpose-specific planned entities
  (`commercial_companies`, `commercial_contacts`) that contain corporate
  pipeline detail not suitable for the canonical person/client record.

Therefore:

- `contacts` is the canonical person/company/client identity for Agent CRM and
  tenancy relationships.
- `client_type` describes CRM lifecycle/persona without translating or copying
  user-entered identity values.
- Do not create a separate `clients` table.
- Do not create a generic `companies` table in Sprint 007.
- A future Commercial installation may keep specialized company/contact
  records, but should add an optional canonical `contact_id` relationship
  rather than duplicating names, phones, and emails.
- CRM's `commercial_listing_id` remains nullable and gains a composite
  workspace FK only when `commercial_listings` actually exists.

## Target Sprint 007 schema

| Entity | Purpose | Required relationships |
|---|---|---|
| `contacts` | Canonical client identity | workspace; optional assigned/creator users |
| `crm_enquiries` | Requirement and qualification pipeline | workspace + contact |
| `crm_listing_matches` | Listing suggestions/client responses | workspace + enquiry; optional Commercial listing |
| `crm_appointments` | Viewings, meetings, signings and handovers | workspace; optional contact/enquiry/deal/Commercial listing |
| `crm_follow_ups` | Due work and communications | workspace; at least one linked CRM/contact/listing reference |
| `crm_deals` | Shared transaction pipeline | workspace + contact; optional enquiry/Commercial listing |
| `crm_enquiry_stage_history` | Immutable enquiry-stage timeline | workspace + enquiry |
| `crm_deal_stage_history` | Immutable deal-stage timeline | workspace + deal |

All entity-to-entity references use `(workspace_id, id)` composite keys where
the parent is workspace scoped. That prevents a valid UUID from another
workspace being attached to the current workspace.

Pipeline stages:

`NEW_ENQUIRY → CONTACTED → QUALIFIED → MATCHED / VIEWING_SCHEDULED →
VIEWING_COMPLETED → FOLLOW_UP / NEGOTIATION → BOOKING → LEGAL → HANDOVER →
CLOSED → AFTER_SALES`, with permitted loss exits to `LOST`.

Status and numeric checks, partial indexes, stage history triggers, and
updated-at triggers are defined in `04_sprint_007_safe_schema.sql`.

## RLS and grants

- All new tables enable RLS.
- `anon` and `PUBLIC` receive no table privileges.
- Workspace members may read according to RBAC.
- Owner/Admin/Manager may create and update operational CRM rows.
- Agents may create/update only rows assigned to their own user ID.
- Finance and Viewer are read-only for CRM/Contacts.
- Deletion is Owner/Admin only.
- UPDATE policies contain both `USING` and `WITH CHECK`.
- Functions are `SECURITY INVOKER`, have fixed empty search paths, and do not
  grant execution to `PUBLIC` or `anon`.
- Authenticated grants are explicit so Data API access does not depend on
  Supabase default privileges.

## Remediation phases

### Phase A — ledger reconciliation

Preserve the 17 live applied rows. Export their SQL and checksums. Align the
repository to deployed history; do not replay stale files or manufacture
applied rows. See `02_ledger_reconciliation_plan.md`.

### Phase B — existing schema normalization

Run the read-only preflight. On an isolated rehearsal database, install the
canonical Contacts prerequisite with workspace-safe relationships, guarded
policies, indexes, RLS, and explicit grants. Commercial and Legal are not
silently installed or modified.

### Phase C — Sprint 007 installation

Install the seven `crm_*` tables, guarded optional Commercial relationships,
constraints, indexes, RLS, triggers, functions, and grants.

### Phase D — verification

Diff the schema; review all policy expressions and grants; run two-workspace
authenticated role tests; validate valid and invalid stage transitions; then
run application API and preview smoke tests.

## Files

- `00_authoritative_state.md` — frozen Git/live schema facts.
- `01_preflight_checks.sql` — read-only inventory and hard blockers.
- `02_ledger_reconciliation_plan.md` — complete local migration classification.
- `03_schema_normalization.sql` — guarded Contacts prerequisite draft.
- `04_sprint_007_safe_schema.sql` — guarded CRM draft.
- `05_post_apply_verification.sql` — read-only schema/RLS verification.
- `06_rollback_plan.md` — rollback limits, approval gates, and next step.

## Deliberately excluded

- Any active migration file
- Any ledger repair command
- Any remote SQL execution
- Commercial schema installation
- Property Intelligence schema installation
- Notifications/branding installation
- Sprint 005 RPC extraction
- Legal comparison schema installation
- OCR, OpenAI extraction, tenancy prompts, deterministic fallback, deposit
  parsing, or normalization

Those gaps remain documented and require their own reviewed replacement
migrations.
