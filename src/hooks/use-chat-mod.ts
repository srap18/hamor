import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Secret chat-moderator status. Returns true only for users listed in
 * public.chat_moderators. Admins/moderators are NOT auto-included here —
 * use `useIsAdmin` for full admin powers.
 *
 * RLS keeps the row visible only to the user themselves (or a true admin),
 * so other players can never tell that a chat-mod exists.
 */
export function useIsChatMod() {
  const { user, loading: authLoading } = useAuth();
  const [isChatMod, setIsChatMod] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { setIsChatMod(false); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("chat_moderators" as never)
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setIsChatMod(!!data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  return { isChatMod, loading: loading || authLoading };
}
