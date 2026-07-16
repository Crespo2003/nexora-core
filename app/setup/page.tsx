import { redirect } from 'next/navigation';
import { getCurrentUserMemberships } from '../../lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function LegacySetupRedirect() {
  const { user } = await getCurrentUserMemberships();
  redirect(user ? '/onboarding/workspace' : '/signup');
}
