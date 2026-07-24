# Ledger reconciliation and migration classification

## Decision

Do not run `supabase db push`, `supabase migration repair`, or any existing
unapplied migration against the shared project. The trusted path is:

1. Preserve all 17 live ledger rows as applied.
2. Export and checksum the SQL stored in each live ledger row.
3. Align repository filenames to the live versions only after exact SQL
   equality is independently reviewed.
4. For a divergent historical file, preserve the deployed SQL as the
   immutable history artifact and move the divergent local file out of the
   active migration chain.
5. Move obsolete, superseded, conflicting, and replaced local migrations out
   of `supabase/migrations` in one separately approved history-reconciliation
   change.
6. Generate a new active replacement migration from the reviewed SQL in this
   package only after all seven gates pass.

No live ledger row should be marked reverted. No currently missing local
timestamp should be marked applied merely to silence drift.

## Complete classification

The primary classification is shown first; safety qualifiers follow it.

| Local migration | Classification | Evidence and disposition |
|---|---|---|
| `202607120004_sprint_001_production_ai_intake.sql` | ALREADY APPLIED AND MATCHING | Live record `20260713155216`; deployed statement matches local content after transport normalization. Align filename/version later. |
| `202607130001_fix_sprint_001_collection_schema.sql` | ALREADY APPLIED AND MATCHING | Live record `20260713155217`; content matches. |
| `202607130002_sprint_002_ai_document_centre.sql` | ALREADY APPLIED AND MATCHING | Live record `20260713155219`; document schema exists. |
| `202607131030_sprint_003_smart_collection_utility.sql` | ALREADY APPLIED AND MATCHING | Live record `20260713155220`; utility/collection objects exist. |
| `202607131145_sprint_003_live_collection_hardening.sql` | ALREADY APPLIED AND MATCHING | Live record `20260713155222`; content matches. |
| `202607131400_sprint_004_auth_workspace_security.sql` | LEDGER-ONLY MISMATCH; CONFLICTING; UNSAFE TO REPLAY | Live record `20260713155223` has the same logical name but a different deployed statement. Workspace schema exists. Preserve deployed SQL; never replay local file. |
| `202607131600_sprint_004_remove_legacy_permissive_policies.sql` | ALREADY APPLIED AND MATCHING | Live record `20260713155411`; matching policy-removal statement. |
| `202607131620_sprint_004_security_advisor_hardening.sql` | ALREADY APPLIED AND MATCHING | Live record `20260713155540`; content matches. |
| `202607131640_sprint_004_final_advisor_hardening.sql` | ALREADY APPLIED AND MATCHING | Live record `20260713161923`; content matches. |
| `202607140033_sprint_004_secure_legacy_tables.sql` | LEDGER-ONLY MISMATCH; CONFLICTING; UNSAFE TO REPLAY | Live record `20260713163707` has different SQL. Current legacy tables are already workspace scoped. Preserve deployed version. |
| `202607140047_sprint_004_legacy_grant_hardening.sql` | ALREADY APPLIED AND MATCHING | Live record `20260713163751`; content matches. |
| `202607140130_sprint_005_ai_tenancy_workspace.sql` | PARTIALLY APPLIED; REQUIRES REPLACEMENT MIGRATION | Only `tenant_company` exists, introduced by a later upload compatibility change. Other columns, checks, and indexes are absent. |
| `202607140230_sprint_005_2_workflow_automation.sql` | NOT APPLIED; REQUIRES REPLACEMENT MIGRATION | Identity/insurance expiry, overpayment credit, retry fields, checks, and indexes are absent. Existing constraint replacement is not safely idempotent. |
| `202607140330_sprint_005_final_blocker_remediation.sql` | CONFLICTING; UNSAFE TO REPLAY; REQUIRES REPLACEMENT MIGRATION | Drops/recreates live unique indexes, weakens the bootstrap probe, and installs nine missing RPCs. Split safe RPC/index remediation from obsolete security changes. |
| `202607142130_sprint_006_ai_commercial_crm.sql` | NOT APPLIED; REQUIRES REPLACEMENT MIGRATION | All Commercial tables/functions/triggers are absent. Existing policy creation and non-idempotent assumptions require a separately reviewed Commercial package. |
| `202607142230_sprint_007_ai_property_intelligence.sql` | NOT APPLIED; REQUIRES REPLACEMENT MIGRATION | Property Intelligence tables/functions are absent and depend on Commercial objects. |
| `20260715005307_harden_bootstrap_security_advisor.sql` | LEDGER-ONLY MISMATCH; SUPERSEDED | Its hardened setup/onboarding objects exist, but no matching ledger row exists. Later onboarding/hotfix state supersedes replay. Capture deployed definitions; do not replay. |
| `20260716101934_sprint_008_multitenant_saas_onboarding.sql` | SUPERSEDED; UNSAFE TO REPLAY | Onboarding tables/functions exist without this base ledger row; two recorded hotfixes replace `provision_workspace`. Replaying would regress the fixed function. |
| `20260716232802_sprint_009_ai_legal_engine.sql` | OBSOLETE; UNSAFE TO REPLAY | Expected early legal objects/functions are not the live canonical legal contract. |
| `202607170001_sprint_010_ai_legal_intelligence.sql` | PARTIALLY APPLIED; SUPERSEDED | Later upload persistence supplied overlapping legal columns/objects; original functions/triggers are absent. |
| `202607170200_sprint_011_ai_legal_stabilization.sql` | PARTIALLY APPLIED; SUPERSEDED | Overlapping schema exists, but Sprint 011 functions/triggers do not. |
| `202607170300_sprint_015_legal_intelligence.sql` | PARTIALLY APPLIED; CONFLICTING; UNSAFE TO REPLAY; REQUIRES REPLACEMENT MIGRATION | Four core legal tables exist. Comparison tables and save-comparison RPC are absent. Replay would overwrite the live upload import wrapper with an obsolete function chain. |
| `202607171300_upload_end_to_end_persistence.sql` | LEDGER-ONLY MISMATCH; CONFLICTING; UNSAFE TO REPLAY | Live `20260717120548_upload_end_to_end_persistence` statement differs from local. It is the active upload contract and must be preserved exactly. |
| `202607171315_upload_end_to_end_tenant_company_compatibility.sql` | ALREADY APPLIED AND MATCHING | Live alias `20260717120711`; `tenant_company` exists. |
| `202607171330_upload_end_to_end_security_invoker.sql` | ALREADY APPLIED AND MATCHING | Live alias `20260717120840`; upload import functions are security invoker. |
| `20260717193513_contact_management_and_collection_routing.sql` | NOT APPLIED; REQUIRES REPLACEMENT MIGRATION | Every Contacts table is absent. Original write policy grants Finance broad writes and cross-workspace FKs are not composite. Use reviewed normalization draft. |
| `20260718040000_whatsapp_communication_metadata.sql` | NOT APPLIED; REQUIRES REPLACEMENT MIGRATION | Depends on Contacts. Fold compatible columns/checks into the canonical Contacts replacement. |
| `20260721000001_repair_document_linked_status.sql` | SUPERSEDED; UNSAFE TO REPLAY | Live remote-only sync migration provides the current behavior; point-in-time stale-link count is zero. |
| `20260721120000_remove_stale_document_links.sql` | SUPERSEDED; UNSAFE TO REPLAY | Destructive cleanup is unnecessary; live remote-only sync supersedes it. |
| `20260723000000_sprint004_workspace_branding_notifications.sql` | NOT APPLIED | Branding and notifications are absent. They do not block Sprint 007 and are excluded from this remediation. |
| `20260724090000_agent_crm_appointment_foundation.sql` | NOT APPLIED; CONFLICTING; UNSAFE TO REPLAY; REQUIRES REPLACEMENT MIGRATION | Contacts and Commercial prerequisites are absent; constraints/policies are not replay-safe. Replace with `04_sprint_007_safe_schema.sql`. |

## Ledger mismatches requiring evidence

Three live logical names contain SQL that differs from the corresponding local
file:

- Sprint 004 auth/workspace security
- Sprint 004 secure legacy tables
- Upload end-to-end persistence

Before any repository-history alignment, require:

- the full live `statements` value;
- SHA-256 of live and local normalized SQL;
- a catalog diff of every object touched;
- confirmation that the live version is the application-compatible version;
- two-person review and a recovery snapshot.

The two upload alias entries and the matching early migrations need the same
checksum evidence before filenames are aligned, even though current comparison
shows them matching.

## Future ledger actions

| Remote record group | Applied | Reverted | Repaired |
|---|---:|---:|---:|
| Existing 17 live records | Keep all | None | None in this package |
| Missing local historical timestamps | None | N/A | Do not mark applied |
| Future replacement migration | Only after execution succeeds | Only if execution record is false | Repair only with post-apply schema evidence |

The preferred reconciliation changes repository history to reflect the live
ledger. It does not falsify the live ledger to resemble stale filenames.

## Unsafe statement patterns and remediation

| Risk | Existing examples | Safe remediation |
|---|---|---|
| Data/index loss | `DROP INDEX`, stale-link `DELETE` | Preflight duplicates; add replacement indexes first; no destructive cleanup in Sprint 007. |
| Policy overwrite | `DROP POLICY` followed by unconditional create | Snapshot definitions; reject unknown policies; replace only approved names in one transaction. |
| Duplicate constraints | Unconditional `ADD CONSTRAINT` in CRM and workflow migrations | Check name and semantic definition; fail on conflicts; add only when absent. |
| Cross-workspace references | Single-column contact/tenancy/commercial FKs | Use `(workspace_id,id)` unique parents and composite FKs. |
| RLS weakening | Broad Finance writes; anonymous bootstrap probe | Explicit per-operation policies; no anonymous table access; preserve hardened bootstrap. |
| Missing prerequisites | CRM references Contacts and Commercial tables | Install canonical Contacts first; make Commercial link optional until its separately reviewed migration exists. |
| Function regression | Sprint 008 and Sprint 015 replace fixed/live functions | Never replay; preserve deployed definitions and add only missing functionality. |
| Existing data conflicts | Future unique/check/FK constraints | Query conflicts first and raise; use `NOT VALID` only when validation is deliberately deferred and approved. |

## Sprint 005 and Legal gaps

| Gap | Expected by | Actual remote | Blocks Sprint 007? | Remediation |
|---|---|---|---:|---|
| tenancy profile columns/checks/search indexes | Sprint 005 | Only `tenant_company` exists | No | Add guarded columns/checks/indexes in a separate approved normalization migration. |
| identity/insurance expiry | Sprint 005.2 | Absent | No | Guarded additive columns. |
| rental overpayment credit | Sprint 005.2 | Absent | No | Add column/check after non-negative preflight. |
| document retry metadata | Sprint 005.2 | Absent | No | Guarded additive columns/check/index. |
| expanded collection payment types | Sprint 005.2 | Old/current check differs | No | Validate live values, then replace constraint transactionally. |
| nine `sprint_005_*` RPCs | Sprint 005 final | Absent while source still contains callers | No for CRM; operational gap | Extract only compatible RPC definitions into a separate reviewed migration. Do not replay bootstrap/index changes. |
| legal analyses/categories/clauses/risks | Sprint 015/upload persistence | Present | No | Preserve live upload schema and wrapper. |
| `tenancy_agreement_comparisons` | Sprint 015 | Absent | No | Separate legal-comparison migration after Sprint 007. |
| comparison findings | Sprint 015 | Absent | No | Same separate migration. |
| `sprint_015_save_tenancy_comparison` | Sprint 015 | Absent | No | Add with comparison tables, without replacing live import function. |

## Go / No-Go

Migration execution is **NO-GO**. The SQL in this directory is a review draft,
not authorization to change the shared project.
