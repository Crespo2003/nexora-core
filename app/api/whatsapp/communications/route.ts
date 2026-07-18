import { NextResponse } from 'next/server';
import { getApiErrorMessage, requireWorkspaceAccess, type AuthContext } from '../../../../lib/supabase/server';
import { normalizePhone } from '../../../../lib/contacts/phone';
import { buildWhatsAppCommunicationRecord, whatsappCommunicationStatuses, type WhatsAppCommunicationStatus } from '../../../../lib/whatsapp/communicationHistory';
import { whatsappTemplateTypes, type WhatsAppLanguage, type WhatsAppTemplateType } from '../../../../lib/whatsapp/messageTemplates';

const languages: WhatsAppLanguage[] = ['en', 'zh', 'bilingual'];

type Payload = {
  tenancyId?: string;
  contactId?: string;
  contactName?: string;
  contactPhone?: string;
  templateType: WhatsAppTemplateType;
  language: WhatsAppLanguage;
  status: WhatsAppCommunicationStatus;
  message?: string;
  followUpDate?: string | null;
  saveMessageBody?: boolean;
};

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Payload;
    if (!whatsappTemplateTypes.includes(payload.templateType) || !languages.includes(payload.language) || !whatsappCommunicationStatuses.includes(payload.status)) {
      return NextResponse.json({ success: false, error: 'invalid-communication-payload' }, { status: 400 });
    }
    if (!payload.contactId && !payload.contactPhone && !payload.contactName) {
      return NextResponse.json({ success: false, error: 'contact-reference-required' }, { status: 400 });
    }

    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent', 'finance'], request);
    if (auth instanceof Response) return auth;
    const { supabase, workspaceId, user } = auth;

    const contactId = await resolveContactId(supabase, workspaceId, payload);
    if (!contactId) {
      return NextResponse.json({ success: false, error: 'contact-not-found' }, { status: 404 });
    }

    const record = buildWhatsAppCommunicationRecord({
      workspaceId,
      tenancyId: payload.tenancyId ?? null,
      contactId,
      templateType: payload.templateType,
      language: payload.language,
      status: payload.status,
      message: payload.message ?? '',
      followUpDate: payload.followUpDate ?? null,
      createdBy: user.id,
      saveMessageBody: Boolean(payload.saveMessageBody)
    });

    const inserted = await supabase.from('contact_communications').insert(record).select('id').single();
    if (inserted.error) throw inserted.error;

    return NextResponse.json({ success: true, communicationId: inserted.data.id });
  } catch (error) {
    return NextResponse.json({ success: false, error: getApiErrorMessage(error) }, { status: 500 });
  }
}

/** Looks up an existing workspace-scoped contact by ID or phone; creates a minimal contact only when neither is found. */
async function resolveContactId(
  supabase: AuthContext['supabase'],
  workspaceId: string,
  payload: Payload
): Promise<string | null> {
  if (payload.contactId) {
    const existing = await supabase.from('contacts').select('id').eq('workspace_id', workspaceId).eq('id', payload.contactId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.id) return String(existing.data.id);
  }

  const phone = normalizePhone(payload.contactPhone ?? '');
  if (phone.normalized) {
    const byPhone = await supabase.from('contacts').select('id').eq('workspace_id', workspaceId).eq('phone_normalized', phone.normalized).maybeSingle();
    if (byPhone.error) throw byPhone.error;
    if (byPhone.data?.id) return String(byPhone.data.id);
  }

  if (!payload.contactName && !phone.normalized) return null;

  const created = await supabase.from('contacts').insert({
    workspace_id: workspaceId,
    contact_type: 'person',
    full_name: payload.contactName ?? '',
    phone_original: payload.contactPhone ?? '',
    phone_normalized: phone.normalized || '',
    phone_country_code: phone.countryCode || '',
    whatsapp_number: phone.whatsappNumber || ''
  }).select('id').single();
  if (created.error) throw created.error;
  return created.data?.id ? String(created.data.id) : null;
}
