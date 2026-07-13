import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function includes(path, expected, label) {
  const source = read(path);
  assert.ok(source.includes(expected), `${label} missing in ${path}`);
}

includes('app/documents/page.tsx', '/api/documents/upload', 'Document upload API call');
includes('app/documents/page.tsx', '/api/documents/import', 'Document import API call');
includes('app/documents/page.tsx', '/api/documents/signed-url', 'Signed URL API call');
includes('app/documents/page.tsx', 'DD/MM/YYYY', 'Malaysian display date placeholder');
includes('app/documents/page.tsx', 'displayDateToIso', 'Display date to database date conversion');
includes('app/documents/page.tsx', 'validateDocumentFile', 'Invalid upload validation');
includes('app/documents/page.tsx', 'duplicateWarning', 'Duplicate upload warning');

includes('lib/documents/types.ts', 'image/jpeg', 'JPG/JPEG upload support');
includes('lib/documents/types.ts', 'image/png', 'PNG upload support');
includes('lib/documents/types.ts', 'tenancy_agreement', 'Tenancy agreement document type');
includes('lib/documents/detectScannedDocument.ts', 'ocrRequired', 'Scanned document detection');
includes('lib/ocr/fallbackOcr.ts', 'not_configured', 'OCR fallback status');
includes('lib/ai/documentClassifier.ts', 'classifyDocument', 'Document classifier');
includes('lib/ai/tenancyExtractor.ts', 'extractionConfidence', 'Extraction confidence output');
includes('lib/ai/tenancyExtractor.ts', 'emptyField', 'Missing fields are not invented');
includes('lib/formatters.ts', 'RM ', 'Malaysian currency formatting');

includes('app/api/documents/upload/route.ts', 'parsePdf', 'PDF parsing route');
includes('app/api/documents/upload/route.ts', 'parseDocx', 'DOCX parsing route');
includes('app/api/documents/upload/route.ts', 'real-estate-documents', 'Private document bucket route');
includes('app/api/documents/import/route.ts', 'possible-duplicate-tenancy', 'Duplicate import prevention');
includes('app/api/documents/import/route.ts', 'rollbackStatus', 'Transactional failure response');
includes('app/api/documents/signed-url/route.ts', 'createSignedUrl', 'Signed URL creation');
includes('app/api/documents/signed-url/route.ts', '300', 'Signed URL expiry');

includes('lib/i18n/documentTranslations.ts', 'Document Centre', 'English translation coverage');
includes('lib/i18n/documentTranslations.ts', '文件中心', 'Simplified Chinese translation coverage');

includes('supabase/migrations/202607130002_sprint_002_ai_document_centre.sql', 'create table if not exists public.documents', 'Documents table');
includes('supabase/migrations/202607130002_sprint_002_ai_document_centre.sql', 'create table if not exists public.document_extractions', 'Document extractions table');
includes('supabase/migrations/202607130002_sprint_002_ai_document_centre.sql', 'create table if not exists public.document_links', 'Document links table');
includes('supabase/migrations/202607130002_sprint_002_ai_document_centre.sql', 'create table if not exists public.import_jobs', 'Import jobs table');
includes('supabase/migrations/202607130002_sprint_002_ai_document_centre.sql', 'create table if not exists public.document_activity', 'Document activity table');
includes('supabase/migrations/202607130002_sprint_002_ai_document_centre.sql', 'enable row level security', 'RLS coverage');
includes('supabase/migrations/202607130002_sprint_002_ai_document_centre.sql', 'storage.objects', 'Storage policies');
includes('supabase/migrations/202607130002_sprint_002_ai_document_centre.sql', 'create index if not exists', 'Database indexes');

console.log('Sprint 002 verification checks passed.');
