# Rollback and approval plan

Rollback starts with a verified Supabase backup/PITR capability and an exported
schema plus ledger snapshot. A rollback document is not a substitute for a
recoverable backup.

## Phase A — ledger reconciliation

Planned action: no live ledger changes. Preserve all 17 applied records and
reconcile repository history to the deployed versions.

If a future approved ledger-only repair is made incorrectly, restore the exact
prior rows using the captured ledger export and Supabase's supported migration
repair workflow. Ledger repair changes history metadata only; it does not undo
schema SQL. Never mark a migration reverted as a substitute for rolling back
its schema.

## Phase B — schema normalization

- Added nullable columns can be dropped only after proving no caller or row
  uses them. Dropping a populated column is destructive and is not presented
  as an automatic rollback.
- Added non-null columns with constant defaults can be removed only under the
  same evidence standard.
- Added constraints can be dropped by exact name. This restores permissiveness,
  not deleted data.
- Added indexes can be dropped by exact name. This can degrade performance and
  uniqueness enforcement.
- Replaced policies can be restored from the pre-apply `pg_policies` snapshot.
  The restore must happen in one transaction to avoid an access gap.
- New Contacts tables can be dropped only if they remain empty and no
  application writes occurred. Once populated, table removal is destructive;
  restore via backup or deploy a forward fix.
- Grants can be restored from the pre-apply ACL snapshot.

## Phase C — Sprint 007 schema

- New empty CRM tables can be removed in reverse dependency order:
  stage history, listing matches, follow-ups, appointments, deals, enquiries.
- Once any CRM row exists, automatic table rollback is unsafe. Disable the
  feature at application level and deploy a forward-compatible fix.
- Triggers can be dropped by exact name and functions removed only after
  checking `pg_depend`.
- Composite foreign keys and unique constraints can be dropped by exact name;
  this does not revert data written while they were active.
- CRM policy rollback restores the captured prior policy definitions. For newly
  created tables there is no prior policy state; revoke Data API grants or
  disable the feature instead of opening access.
- Stage changes recorded during the deployment are business records and must
  not be deleted as a rollback shortcut.

## Phase D — verification

Verification is read-only. No rollback is required. A failed verification gate
means stop, revoke/disable the new application surface if necessary, preserve
evidence, and choose either the safe empty-schema removal or a forward fix.

## Mandatory gates

1. **Authoritative inventory confirmed** — rerun `01_preflight_checks.sql`;
   archive its complete output; two reviewers confirm the project reference and
   object definitions.
2. **Recovery confirmed** — project owner confirms current backup/PITR coverage
   and performs a restore rehearsal on an isolated Supabase branch or separate
   project.
3. **Ledger plan approved** — deployed statements and checksums are preserved;
   no stale local SQL is designated canonical.
4. **Preflight has no blockers** — all assertion queries and explicit
   exceptions pass on a fresh snapshot.
5. **Safe SQL reviewed** — database/security reviewers sign off the exact
   generated active migration, not just these drafts.
6. **Post-apply tests ready** — `05_post_apply_verification.sql`, role matrix,
   and application smoke cases are reviewed before execution.
7. **Authenticated preview credentials available** — at least two users in
   different workspaces plus owner/admin/manager/agent/finance/viewer roles are
   available in a non-production rehearsal environment.

Sprint 007 remains **NO-GO** until every gate is recorded as passed.

## Exact next execution step

Do not execute against the shared project. Create an isolated Supabase
development branch (or separate staging project), load a schema-only snapshot
of the current live state, and run `01_preflight_checks.sql` there. Only after
Gate 1 and Gate 2 pass should reviewers convert the approved parts of
`03_schema_normalization.sql` and `04_sprint_007_safe_schema.sql` into newly
generated active migrations.
