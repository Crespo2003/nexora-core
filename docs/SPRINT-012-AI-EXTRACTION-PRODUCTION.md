# Sprint 012 — Production AI Tenancy Extraction

## Vercel environment variables

Set `OPENAI_API_KEY` as a sensitive, server-only variable in Vercel for Production and Preview. Never prefix it with `NEXT_PUBLIC_`, commit it, print it, or return it from an API route.

The model variables are optional:

- `OPENAI_TENANCY_MODEL` defaults to `gpt-5.5`.
- `OPENAI_OCR_MODEL` defaults to `gpt-4.1-mini`.

Leaving either model variable unset does not disable AI extraction. After adding or changing a Vercel variable, create a new deployment so the server runtime receives the updated value.

## Safe configuration verification

While signed in with an active Owner, Admin, Manager, or Agent workspace membership, request:

```text
GET /api/tenancy-import/config-status
```

The response contains only `configured`, `tenancyModel`, `ocrModel`, and `reason`. It never returns the API key. Production is ready for an AI request only when `configured` is `true` and `reason` is `configured`.

## Live production verification

1. Confirm the configuration-status endpoint reports `configured: true`.
2. Open Rental Command Centre and upload a reviewed text-based Malaysian tenancy PDF.
3. Confirm the upload response has `success: true`, `provider: "openai"`, `fallbackUsed: false`, and `fallbackReason: null`.
4. Confirm the page shows “AI extraction completed successfully” and the configured OpenAI model.
5. Compare populated values, confidence indicators, summary, risks, warnings, page references, and excerpts with the complete source agreement.
6. Repeat with a DOCX and TXT agreement.
7. Upload a reviewed scanned PDF. Confirm `extraction.document.usedOcr` is `true`, all pages are represented, and `provider` remains `openai`.
8. Confirm the import and verify the tenancy, document, extraction, collection, correction metadata, and audit activity remain workspace-scoped.
9. Upload the same file again and confirm `duplicate-document` is returned without a second tenancy or document.
10. Review Vercel runtime logs. Logs may contain file type, text length, OCR usage, configuration status, model, provider, fallback reason, and persistence status; they must not contain document text or personal details.

Do not claim the live AI path is active if the response reports the deterministic provider.

## Expected OpenAI success response

```json
{
  "success": true,
  "provider": "openai",
  "model": "gpt-5.5",
  "fallbackUsed": false,
  "fallbackReason": null,
  "documentId": "storage-object-id",
  "extraction": {},
  "summary": "...",
  "risks": [],
  "warnings": [],
  "confidence": 0.95
}
```

## Expected deterministic fallback response

```json
{
  "success": true,
  "provider": "deterministic",
  "model": null,
  "fallbackUsed": true,
  "fallbackReason": "openai_request_failed",
  "documentId": "storage-object-id",
  "extraction": {},
  "summary": "...",
  "risks": [],
  "warnings": [],
  "confidence": 0.4
}
```

Allowed fallback reason codes are `openai_not_configured`, `openai_authentication_failed`, `openai_permission_denied`, `openai_model_not_found`, `openai_rate_limited`, `openai_bad_request`, `openai_server_error`, `openai_timeout`, `openai_request_failed`, `invalid_ai_response`, `ocr_failed`, and `text_extraction_failed`. `openai_not_configured` is reserved for a missing or empty server-side `OPENAI_API_KEY`; API authentication and provider failures use their own reason codes. OCR or text-extraction failures preserve the uploaded document and return an actionable bilingual failure instead of a fabricated extraction.

## Safe rollback

1. Keep the database migrations in place; Sprint 012 does not require a destructive schema rollback.
2. Roll Vercel back to the previous known-good deployment.
3. Keep `OPENAI_API_KEY` server-only. Remove or rotate it only if credential compromise is suspected.
4. Preserve uploaded documents and failed extraction records for retry; do not delete user documents as part of rollback.
5. Verify authentication, workspace isolation, duplicate prevention, and the deterministic fallback before restoring traffic.
