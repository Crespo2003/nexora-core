import { createClient } from '@supabase/supabase-js';

export function getServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Supabase server configuration is missing.');
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export function getApiErrorMessage(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String(error.message)
        : '';

  if (message.includes('Supabase server configuration is missing')) return 'database-unavailable';
  if (message.includes('relation') && message.includes('does not exist')) return 'tables-missing';
  if (message) return message;
  return 'Unexpected server error.';
}
