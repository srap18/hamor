-- Follow-up hardening: prevent fake profile inserts/deletes with forged rank/VIP/currency.

REVOKE INSERT, DELETE ON TABLE public.profiles FROM anon, authenticated, PUBLIC;
GRANT SELECT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

CREATE OR REPLACE FUNCTION public.guard_profiles_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.role() = 'service_role'
     OR current_user IN ('postgres','supabase_admin','service_role','supabase_auth_admin')
     OR session_user IN ('postgres','supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR NEW.id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'forbidden: profile owner only';
  END IF;

  -- Force server-controlled values on client-created rows.
  NEW.level := 1;
  NEW.xp := 0;
  NEW.coins := 1000;
  NEW.gems := 1000;
  NEW.rubies := 5;
  NEW.tribe_id := NULL;
  NEW.protection_until := NULL;
  NEW.steal_blocked_until := NULL;
  NEW.vip_level := 0;
  NEW.vip_points := 0;
  NEW.vip_expires_at := NULL;
  NEW.vip_subs_claimed := 0;
  NEW.bg_burned_until := NULL;
  NEW.armor_last_bought_at := NULL;
  NEW.last_destroyer_id := NULL;
  NEW.last_destroyer_name := NULL;
  NEW.last_destroyer_kind := NULL;
  NEW.last_destroyer_at := NULL;
  NEW.last_destroyer_message := NULL;
  NEW.tribe_gems := 0;
  NEW.weekly_xp := 0;
  NEW.media_banned := false;
  NEW.referral_locked_at := NULL;
  NEW.golden_fisher_until := NULL;
  NEW.golden_fisher_last_activated_at := NULL;
  NEW.elite_vip_level := 0;
  NEW.elite_vip_expires_at := NULL;
  NEW.active_session_id := NULL;
  NEW.active_session_ip := NULL;
  NEW.active_session_ua := NULL;
  NEW.active_session_started_at := NULL;
  NEW.created_at := now();
  NEW.online_at := now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profiles_insert ON public.profiles;
CREATE TRIGGER trg_guard_profiles_insert
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_profiles_insert();

DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
-- Client profile creation is intentionally closed; account creation/profile bootstrap must run server-side.

DROP POLICY IF EXISTS profiles_delete_self ON public.profiles;
DROP POLICY IF EXISTS profiles_delete_own ON public.profiles;