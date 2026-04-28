import { useEffect, useState } from 'react';
import { supabase, getValidSession, isSupabaseConfigured } from './supabase';

/**
 * Returns:
 *   null    – still loading / unknown (do not render any gate yet)
 *   true    – current user is the confirmed owner of this farmstand
 *   false   – confirmed NOT the owner (show claim pending screen)
 *
 * Usage:
 *   const canManage = useCanManageFarmstand(farmstand.id);
 *   if (canManage === null) return <LoadingSpinner />;
 *   if (!canManage) return <ClaimPendingScreen />;
 */
export function useCanManageFarmstand(farmstandId?: string): boolean | null {
  const [canManage, setCanManage] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;

    if (!farmstandId || !isSupabaseConfigured()) {
      // No farmstand id yet — stay in loading state rather than flashing "not approved"
      return;
    }

    (async () => {
      const session = await getValidSession();
      if (!session || !alive) {
        if (alive) setCanManage(false);
        return;
      }

      // Decode user ID from JWT (sub claim)
      let userId: string | null = null;
      try {
        const payload = JSON.parse(atob(session.access_token.split('.')[1]));
        userId = payload.sub ?? null;
      } catch {
        if (alive) setCanManage(false);
        return;
      }

      if (!userId) {
        if (alive) setCanManage(false);
        return;
      }

      const { data, error } = await supabase
        .from<Record<string, unknown>>('farmstands')
        .select('id')
        .eq('id', farmstandId)
        .eq('owner_id', userId)
        .execute();

      if (alive) {
        setCanManage(!error && Array.isArray(data) && data.length > 0);
      }
    })();

    return () => {
      alive = false;
    };
  }, [farmstandId]);

  return canManage;
}
