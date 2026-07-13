'use client';

import { useEffect, useMemo } from 'react';
import { getBrowserSupabaseClient } from '../../lib/supabase/browser';

export default function LogoutPage() {
  const supabase = useMemo(getBrowserSupabaseClient, []);

  useEffect(() => {
    async function logout() {
      await supabase?.auth.signOut();
      window.location.href = '/login';
    }
    void logout();
  }, [supabase]);

  return <main className="auth-shell"><section className="auth-panel"><h1>Signing out...</h1></section></main>;
}
