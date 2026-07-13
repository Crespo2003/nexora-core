import { NextResponse } from 'next/server';
import { getApiErrorMessage, getServerSupabaseClient } from '../../../../lib/supabase/server';

const storageBucket = 'tenancy-documents';

export async function POST(request: Request) {
  try {
    const { storagePath } = (await request.json()) as { storagePath?: string };

    if (!storagePath) {
      return NextResponse.json({ error: 'Document unavailable.', stage: 'signed-url' }, { status: 400 });
    }

    const supabase = getServerSupabaseClient();
    const { data, error } = await supabase.storage.from(storageBucket).createSignedUrl(storagePath, 60 * 5);
    if (error) throw error;

    return NextResponse.json({ signedUrl: data.signedUrl, expiresIn: 300 });
  } catch (error) {
    console.error('Create document signed URL failed', error);
    return NextResponse.json({ error: getApiErrorMessage(error), stage: 'signed-url' }, { status: 500 });
  }
}
