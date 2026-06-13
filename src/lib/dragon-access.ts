// Allowlist of user IDs that have the dragon feature unlocked.
// Add a UID here to give that account access to /dragon and the live egg button.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const DRAGON_UNLOCKED_USER_IDS = new Set<string>([
  // ccx13zx2
  "d245f49e-1cd6-4eb3-a06e-cd063d9fd2f2",
  // جاك سبارو (admin)
  "7035f6b9-7bb2-41e2-a8b8-050d0e7f41c0",
]);

export function isDragonUnlockedFor(userId: string | null | undefined): boolean {
  return !!userId && DRAGON_UNLOCKED_USER_IDS.has(userId);
}

/** Hook: returns true once we confirm the signed-in user has dragon access. */
export function useDragonUnlocked(): boolean {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (alive) setUnlocked(isDragonUnlockedFor(data.user?.id));
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUnlocked(isDragonUnlockedFor(session?.user?.id));
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return unlocked;
}
