import { NextResponse } from 'next/server';
import { currentIsoMonth } from '../../../../lib/dates/formatDate';
import { getApiErrorMessage, getServerSupabaseClient } from '../../../../lib/supabase/server';

function collectionForTenancy(tenancyId: string, monthlyRental: number) {
  const month = currentIsoMonth();
  const dueDate = `${month}-01`;

  return {
    tenancy_id: tenancyId,
    collection_month: dueDate,
    due_date: dueDate,
    rental_amount: monthlyRental,
    tnb_amount: 0,
    water_amount: 0,
    iwk_amount: 0,
    wifi_amount: 0,
    aircond_amount: 0,
    other_charges: 0,
    amount_paid: 0,
    payment_status: 'outstanding',
    payment_history: []
  };
}

export async function POST(request: Request) {
  let tenancyId: string | null = null;
  let importJobId: string | null = null;

  try {
    const { documentId, reviewedJson, importType = 'tenancy_agreement' } = await request.json();

    if (!documentId || !reviewedJson) {
      return NextResponse.json({ error: 'missing-review', stage: 'review' }, { status: 400 });
    }

    const supabase = getServerSupabaseClient();

    const jobInsert = await supabase
      .from('import_jobs')
      .insert({
        document_id: documentId,
        import_type: importType,
        reviewed_json: reviewedJson,
        import_status: 'saving'
      })
      .select('*')
      .single();

    if (jobInsert.error) throw jobInsert.error;
    importJobId = jobInsert.data.id;

    const duplicate = await supabase
      .from('tenancies')
      .select('id')
      .eq('tenant', reviewedJson.tenant ?? '')
      .eq('property', reviewedJson.property ?? '')
      .eq('unit_no', reviewedJson.unitNo ?? '')
      .maybeSingle();

    if (duplicate.error) throw duplicate.error;
    if (duplicate.data) {
      await supabase.from('import_jobs').update({
        import_status: 'failed',
        failed_stage: 'duplicate-match',
        error_message: 'possible-duplicate-tenancy'
      }).eq('id', importJobId);

      return NextResponse.json({ error: 'possible-duplicate-tenancy', stage: 'duplicate-match' }, { status: 409 });
    }

    const tenancyInsert = await supabase
      .from('tenancies')
      .insert({
        tenant: reviewedJson.tenant ?? '',
        tenant_id_no: reviewedJson.tenantIdNo ?? '',
        tenant_phone: reviewedJson.tenantPhone ?? '',
        tenant_email: reviewedJson.tenantEmail ?? '',
        landlord: reviewedJson.landlord ?? '',
        landlord_id_no: reviewedJson.landlordIdNo ?? '',
        landlord_phone: reviewedJson.landlordPhone ?? '',
        landlord_email: reviewedJson.landlordEmail ?? '',
        property: reviewedJson.property ?? '',
        unit_no: reviewedJson.unitNo ?? '',
        property_address: reviewedJson.propertyAddress ?? '',
        property_type: reviewedJson.propertyType ?? '',
        monthly_rental: reviewedJson.monthlyRental ?? 0,
        security_deposit: reviewedJson.securityDeposit ?? 0,
        utility_deposit: reviewedJson.utilityDeposit ?? 0,
        access_card_deposit: reviewedJson.accessCardDeposit ?? 0,
        car_park_remote_deposit: reviewedJson.carParkRemoteDeposit ?? 0,
        commencement_date: reviewedJson.commencementDateIso,
        expiry_date: reviewedJson.expiryDateIso,
        renewal_option: reviewedJson.renewalOption ?? '',
        notice_period: reviewedJson.noticePeriod ?? '',
        renewal_reminder: reviewedJson.renewalReminderIso || null,
        signed_ta: reviewedJson.originalFilename ?? '',
        renewal_history: reviewedJson.renewalHistory ?? '',
        special_clauses: reviewedJson.specialClauses ?? '',
        notes: reviewedJson.notes ?? '',
        status: 'active'
      })
      .select('*')
      .single();

    if (tenancyInsert.error) throw tenancyInsert.error;
    tenancyId = tenancyInsert.data.id;

    const collectionInsert = await supabase
      .from('rental_collections')
      .insert(collectionForTenancy(tenancyId, Number(reviewedJson.monthlyRental ?? 0)))
      .select('*')
      .single();

    if (collectionInsert.error) throw collectionInsert.error;

    await supabase.from('document_links').insert({
      document_id: documentId,
      entity_type: 'tenancy',
      entity_id: tenancyId,
      link_type: 'source_document'
    });

    await supabase.from('documents').update({
      linked_status: 'linked',
      processing_status: 'imported'
    }).eq('id', documentId);

    await supabase.from('import_jobs').update({
      import_status: 'completed',
      created_record_ids: {
        tenancyId,
        collectionId: collectionInsert.data.id
      }
    }).eq('id', importJobId);

    await supabase.from('document_activity').insert({
      document_id: documentId,
      activity_type: 'import_confirmed',
      activity_json: { tenancyId, collectionId: collectionInsert.data.id }
    });

    return NextResponse.json({
      success: true,
      tenancy: tenancyInsert.data,
      collection: collectionInsert.data,
      importJobId,
      rollbackStatus: 'not_required'
    });
  } catch (error) {
    console.error('Document Centre import failed', error);

    try {
      const supabase = getServerSupabaseClient();
      if (tenancyId) await supabase.from('tenancies').delete().eq('id', tenancyId);
      if (importJobId) {
        await supabase.from('import_jobs').update({
          import_status: 'failed',
          failed_stage: tenancyId ? 'collection-or-link' : 'tenancy',
          error_message: getApiErrorMessage(error)
        }).eq('id', importJobId);
      }
    } catch (cleanupError) {
      console.error('Document Centre import cleanup failed', cleanupError);
    }

    return NextResponse.json({
      success: false,
      error: getApiErrorMessage(error),
      stage: tenancyId ? 'collection-or-link' : 'tenancy',
      rollbackStatus: tenancyId ? 'attempted' : 'not_required'
    }, { status: 500 });
  }
}
