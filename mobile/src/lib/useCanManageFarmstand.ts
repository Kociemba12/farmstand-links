import { useEffect, useState } from 'react';
import { supabase, getValidSession, isSupabaseConfigured } from './supabase';

/**
 * Returns true if the currently authenticated user is the owner of the given farmstand.
 * Ownership is determined by the `owner_id` column on the `farmstands` table.
 *
 * Usage:
 *   const canManage = useCanManageFarmstand(farmstand.id);
 *   // Show Manage/Edit ONLY if canManage === true.
 *   // Otherwise show Claim / Claim Pending.
 */
export function useCanManageFarmstand(farmstandId?: string): boolean {
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let alive = true;

    if (!farmstandId || !isSupabaseConfigured()) {
      setCanManage(false);
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
