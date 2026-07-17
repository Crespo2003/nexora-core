# Sprint 015 legal intelligence acceptance

Run these checks in a non-production workspace after applying the Sprint 015 migration. Do not use real identity documents unless the workspace’s data-handling policy permits it.

1. Upload and extract an English residential agreement with rental, deposits, dates, renewal, termination, utilities, maintenance, inspection, inventory, witness and stamp-duty wording. Confirm the existing import review still maps every tenancy form field.
2. Confirm the agreement-review panel shows an executive summary, clause count, source-page excerpts, confidence values and high/medium/low risk badges.
3. Filter clauses by Financial, Renewal, Termination, Maintenance, Utilities, Entry and Restrictions. Each filter must only show its corresponding clauses.
4. Search for a known word from a clause obligation and confirm the relevant source-backed clause remains visible.
5. Upload an agreement with no renewal wording. Confirm a medium `Renewal clause missing` legal-review risk appears.
6. Upload an agreement with no termination wording. Confirm a high `Termination clause missing` legal-review risk appears.
7. Upload an agreement with no inspection or viewing wording. Confirm a medium inspection legal-review risk appears.
8. Upload an agreement that says a security deposit is two months of rent but gives a different amount. Confirm the high deposit-mismatch risk appears.
9. Upload an agreement with two different monthly rentals. Confirm the high conflicting-rental risk appears and no value is silently selected as authoritative.
10. Upload an agreement allowing entry without prior notice or at any time. Confirm an entry-rights legal-review risk appears, with a source excerpt.
11. Upload a scanned PDF and a DOCX containing the same material clauses. Confirm each uses the existing text/OCR extraction path and reaches the same review panel without exposing an API key in the browser.
12. Save two analysed agreements in the same workspace, select them as Agreement A and Agreement B, and compare them. Confirm changes to rental, deposits, commencement/expiry dates, renewal, notice and termination are shown with Agreement A and B values.
13. Add a clause only to Agreement B, remove one from Agreement B, then alter the wording of another. Confirm the comparison shows added, removed and modified clauses separately.
14. Sign in as a user of another workspace. Confirm neither the agreement list nor comparison endpoint can reveal, compare or persist another workspace’s documents.
15. Repeat the same confirmed import and the same comparison. Confirm legal analysis and comparison records are updated idempotently without duplicates, while the dashboard refreshes through the existing post-import flow.

Acceptance requires all checks to pass, no tenancy-form regression, no client-side OpenAI key, and no server log containing document text, party identity, or secret values.
