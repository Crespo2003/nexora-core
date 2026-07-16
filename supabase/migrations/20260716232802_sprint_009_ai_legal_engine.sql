-- Sprint 009: atomically persist an AI tenancy import and its first collection.

update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png'
]
where id = 'real-estate-documents';

create or replace function public.sprint_009_import_tenancy_legal_intelligence(
  p_workspace_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  tenancy_payload jsonb := p_payload -> 'tenancy';
  collection_payload jsonb := p_payload -> 'collection';
  document_payload jsonb := p_payload -> 'document';
  extraction_payload jsonb := p_payload -> 'extraction';
  tenancy_row public.tenancies;
  document_row public.tenancy_documents;
  extraction_row public.tenancy_extractions;
  document_centre_row public.documents;
  document_extraction_row public.document_extractions;
  document_link_row public.document_links;
  collection_row public.rental_collections;
  payment_row public.collection_payments;
  imported_amount numeric := greatest(coalesce((collection_payload ->> 'amount_paid')::numeric, 0), 0);
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if not public.has_workspace_role(p_workspace_id, array['owner', 'admin', 'manager', 'agent']) then
    raise exception using errcode = '42501', message = 'workspace permission denied';
  end if;
  if tenancy_payload is null or collection_payload is null or document_payload is null or extraction_payload is null then
    raise exception using errcode = '22023', message = 'incomplete tenancy import payload';
  end if;
  if exists (
    select 1
    from public.tenancies t
    where t.workspace_id = p_workspace_id
      and lower(btrim(t.tenant)) = lower(btrim(tenancy_payload ->> 'tenant'))
      and lower(btrim(t.property)) = lower(btrim(tenancy_payload ->> 'property'))
      and lower(btrim(t.unit_no)) = lower(btrim(coalesce(tenancy_payload ->> 'unit_no', '')))
  ) then
    raise exception using errcode = '23505', message = 'duplicate tenancy';
  end if;

  insert into public.tenancies (
    workspace_id, tenant, tenant_id_no, tenant_phone, tenant_email,
    landlord, landlord_id_no, landlord_phone, landlord_email,
    property, unit_no, property_address, property_type,
    monthly_rental, security_deposit, utility_deposit, access_card_deposit,
    car_park_remote_deposit, commencement_date, expiry_date, renewal_option,
    notice_period, renewal_reminder, signed_ta, renewal_history,
    special_clauses, notes, status, rental_due_day, tenant_company
  ) values (
    p_workspace_id,
    btrim(tenancy_payload ->> 'tenant'),
    coalesce(tenancy_payload ->> 'tenant_id_no', ''),
    coalesce(tenancy_payload ->> 'tenant_phone', ''),
    coalesce(tenancy_payload ->> 'tenant_email', ''),
    btrim(tenancy_payload ->> 'landlord'),
    coalesce(tenancy_payload ->> 'landlord_id_no', ''),
    coalesce(tenancy_payload ->> 'landlord_phone', ''),
    coalesce(tenancy_payload ->> 'landlord_email', ''),
    btrim(tenancy_payload ->> 'property'),
    coalesce(tenancy_payload ->> 'unit_no', ''),
    coalesce(tenancy_payload ->> 'property_address', ''),
    coalesce(tenancy_payload ->> 'property_type', ''),
    greatest(coalesce((tenancy_payload ->> 'monthly_rental')::numeric, 0), 0),
    greatest(coalesce((tenancy_payload ->> 'security_deposit')::numeric, 0), 0),
    greatest(coalesce((tenancy_payload ->> 'utility_deposit')::numeric, 0), 0),
    greatest(coalesce((tenancy_payload ->> 'access_card_deposit')::numeric, 0), 0),
    greatest(coalesce((tenancy_payload ->> 'car_park_remote_deposit')::numeric, 0), 0),
    (tenancy_payload ->> 'commencement_date')::date,
    (tenancy_payload ->> 'expiry_date')::date,
    coalesce(tenancy_payload ->> 'renewal_option', ''),
    coalesce(tenancy_payload ->> 'notice_period', ''),
    nullif(tenancy_payload ->> 'renewal_reminder', '')::date,
    coalesce(tenancy_payload ->> 'signed_ta', ''),
    coalesce(tenancy_payload ->> 'renewal_history', ''),
    coalesce(tenancy_payload ->> 'special_clauses', ''),
    coalesce(tenancy_payload ->> 'notes', ''),
    coalesce(nullif(tenancy_payload ->> 'status', ''), 'active'),
    greatest(1, least(31, coalesce((tenancy_payload ->> 'rental_due_day')::integer, 1))),
    coalesce(tenancy_payload ->> 'tenant_company', '')
  )
  returning * into tenancy_row;

  insert into public.tenancy_documents (
    tenancy_id, workspace_id, original_filename, storage_path, mime_type,
    file_size, document_type, upload_status
  ) values (
    tenancy_row.id, p_workspace_id,
    document_payload ->> 'originalFilename', document_payload ->> 'storagePath',
    document_payload ->> 'mimeType', coalesce((document_payload ->> 'fileSize')::bigint, 0),
    coalesce(document_payload ->> 'documentType', 'tenancy_agreement'),
    coalesce(document_payload ->> 'uploadStatus', 'uploaded')
  )
  returning * into document_row;

  insert into public.tenancy_extractions (
    tenancy_document_id, workspace_id, extraction_status, extracted_json,
    raw_text, ai_summary, confidence_json, extraction_error
  ) values (
    document_row.id, p_workspace_id,
    coalesce(extraction_payload ->> 'extractionStatus', 'ready'),
    coalesce(extraction_payload -> 'extractedJson', '{}'::jsonb),
    coalesce(extraction_payload ->> 'rawText', ''),
    coalesce(extraction_payload ->> 'aiSummary', ''),
    coalesce(extraction_payload -> 'confidenceJson', '{}'::jsonb),
    nullif(extraction_payload ->> 'extractionError', '')
  )
  returning * into extraction_row;

  insert into public.documents (
    workspace_id, owner_user_id, original_filename, sanitized_filename,
    storage_bucket, storage_path, mime_type, file_size, document_type,
    upload_status, processing_status, linked_status
  ) values (
    p_workspace_id, (select auth.uid()),
    document_payload ->> 'originalFilename',
    regexp_replace(document_payload ->> 'storagePath', '^.*/', ''),
    'real-estate-documents', document_payload ->> 'storagePath',
    document_payload ->> 'mimeType', coalesce((document_payload ->> 'fileSize')::bigint, 0),
    'tenancy_agreement', coalesce(document_payload ->> 'uploadStatus', 'uploaded'),
    'extraction_completed', 'linked'
  )
  returning * into document_centre_row;

  insert into public.document_extractions (
    document_id, workspace_id, extraction_version, raw_text, extracted_json,
    confidence_json, ai_summary, extraction_status, extraction_error,
    started_at, completed_at
  ) values (
    document_centre_row.id, p_workspace_id, 'gpt-legal-v1',
    coalesce(extraction_payload ->> 'rawText', ''),
    coalesce(extraction_payload -> 'extractedJson', '{}'::jsonb),
    coalesce(extraction_payload -> 'confidenceJson', '{}'::jsonb),
    coalesce(extraction_payload ->> 'aiSummary', ''),
    'extraction_completed', nullif(extraction_payload ->> 'extractionError', ''),
    now(), now()
  )
  returning * into document_extraction_row;

  insert into public.document_links (
    document_id, workspace_id, entity_type, entity_id, link_type
  ) values (
    document_centre_row.id, p_workspace_id, 'tenancy', tenancy_row.id, 'source_document'
  )
  returning * into document_link_row;

  insert into public.rental_collections (
    tenancy_id, workspace_id, collection_month, due_date, rental_amount,
    tnb_amount, water_amount, iwk_amount, wifi_amount, aircond_amount,
    other_charges, amount_paid, payment_status, payment_date,
    payment_method, payment_reference, notes, payment_history
  ) values (
    tenancy_row.id, p_workspace_id,
    (collection_payload ->> 'collection_month')::date,
    (collection_payload ->> 'due_date')::date,
    greatest(coalesce((collection_payload ->> 'rental_amount')::numeric, 0), 0),
    greatest(coalesce((collection_payload ->> 'tnb_amount')::numeric, 0), 0),
    greatest(coalesce((collection_payload ->> 'water_amount')::numeric, 0), 0),
    greatest(coalesce((collection_payload ->> 'iwk_amount')::numeric, 0), 0),
    greatest(coalesce((collection_payload ->> 'wifi_amount')::numeric, 0), 0),
    greatest(coalesce((collection_payload ->> 'aircond_amount')::numeric, 0), 0),
    greatest(coalesce((collection_payload ->> 'other_charges')::numeric, 0), 0),
    imported_amount,
    coalesce(collection_payload ->> 'payment_status', 'outstanding'),
    nullif(collection_payload ->> 'payment_date', '')::date,
    coalesce(collection_payload ->> 'payment_method', ''),
    coalesce(collection_payload ->> 'payment_reference', ''),
    coalesce(collection_payload ->> 'notes', ''),
    coalesce(collection_payload -> 'payment_history', '[]'::jsonb)
  )
  returning * into collection_row;

  if imported_amount > 0 then
    insert into public.collection_payments (
      rental_collection_id, workspace_id, amount, payment_date, payment_method,
      payment_reference, notes, recorded_by, transaction_type
    ) values (
      collection_row.id, p_workspace_id, imported_amount,
      coalesce(nullif(collection_payload ->> 'payment_date', '')::date, current_date),
      case coalesce(collection_payload ->> 'payment_method', '')
        when 'bank_transfer' then 'bank_transfer'
        when 'cash' then 'cash'
        when 'duitnow' then 'duitnow'
        when 'touch_n_go' then 'touch_n_go'
        when 'cheque' then 'cheque'
        when 'online_banking' then 'online_banking'
        else 'other'
      end,
      coalesce(collection_payload ->> 'payment_reference', ''),
      'Imported with tenancy agreement',
      (select auth.uid())::text,
      'payment'
    )
    returning * into payment_row;
  end if;

  insert into public.activity_logs (
    workspace_id, entity_type, entity_id, activity_type, activity_json, created_by
  ) values (
    p_workspace_id, 'tenancy', tenancy_row.id, 'ai_legal_tenancy_imported',
    jsonb_build_object(
      'documentId', document_centre_row.id,
      'legacyDocumentId', document_row.id,
      'extractionId', extraction_row.id,
      'documentExtractionId', document_extraction_row.id,
      'collectionId', collection_row.id,
      'paymentId', payment_row.id,
      'model', extraction_payload ->> 'model',
      'confidence', extraction_payload -> 'extractedJson' -> 'confidence',
      'riskCount', jsonb_array_length(coalesce(extraction_payload -> 'extractedJson' -> 'risks', '[]'::jsonb)),
      'warningCount', jsonb_array_length(coalesce(extraction_payload -> 'extractedJson' -> 'warnings', '[]'::jsonb))
    ),
    (select auth.uid())::text
  );

  return jsonb_build_object(
    'tenancy', to_jsonb(tenancy_row),
    'document', to_jsonb(document_row),
    'documentCentre', to_jsonb(document_centre_row),
    'extraction', to_jsonb(extraction_row),
    'collection', to_jsonb(collection_row),
    'payment', case when payment_row.id is null then null else to_jsonb(payment_row) end
  );
end;
$$;

revoke all on function public.sprint_009_import_tenancy_legal_intelligence(uuid, jsonb) from public, anon;
grant execute on function public.sprint_009_import_tenancy_legal_intelligence(uuid, jsonb) to authenticated;
