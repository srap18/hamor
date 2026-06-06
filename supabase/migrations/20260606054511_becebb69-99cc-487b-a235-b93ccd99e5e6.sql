
CREATE OR REPLACE FUNCTION public.guard_profiles_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  is_service boolean := (auth.role() = 'service_role');
  is_admin_user boolean := false;
BEGIN
  -- Allow service role, postgres owner, and any SECURITY DEFINER function
  -- (in SECURITY DEFINER the effective role becomes the function owner,
  -- which is reflected by current_user).
  IF is_service
     OR current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin')
     OR session_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  BEGIN
    is_admin_user := public.is_admin(auth.uid());
  EXCEPTION WHEN OTHERS THEN
    is_admin_user := false;
  END;

  IF is_admin_user THEN
    RETURN NEW;
  END IF;

  IF NEW.coins IS DISTINCT FROM OLD.coins THEN RAISE EXCEPTION 'forbidden: coins'; END IF;
  IF NEW.gems IS DISTINCT FROM OLD.gems THEN RAISE EXCEPTION 'forbidden: gems'; END IF;
  IF NEW.rubies IS DISTINCT FROM OLD.rubies THEN RAISE EXCEPTION 'forbidden: rubies'; END IF;
  IF NEW.vip_points IS DISTINCT FROM OLD.vip_points THEN RAISE EXCEPTION 'forbidden: vip_points'; END IF;
  IF NEW.vip_level IS DISTINCT FROM OLD.vip_level THEN RAISE EXCEPTION 'forbidden: vip_level'; END IF;
  IF NEW.vip_expires_at IS DISTINCT FROM OLD.vip_expires_at THEN RAISE EXCEPTION 'forbidden: vip_expires_at'; END IF;
  IF NEW.vip_subs_claimed IS DISTINCT FROM OLD.vip_subs_claimed THEN RAISE EXCEPTION 'forbidden: vip_subs_claimed'; END IF;
  IF NEW.tribe_gems IS DISTINCT FROM OLD.tribe_gems THEN RAISE EXCEPTION 'forbidden: tribe_gems'; END IF;
  IF NEW.level IS DISTINCT FROM OLD.level THEN RAISE EXCEPTION 'forbidden: level'; END IF;
  IF NEW.xp IS DISTINCT FROM OLD.xp THEN RAISE EXCEPTION 'forbidden: xp'; END IF;
  IF NEW.weekly_xp IS DISTINCT FROM OLD.weekly_xp THEN RAISE EXCEPTION 'forbidden: weekly_xp'; END IF;
  IF NEW.protection_until IS DISTINCT FROM OLD.protection_until THEN RAISE EXCEPTION 'forbidden: protection_until'; END IF;
  IF NEW.steal_blocked_until IS DISTINCT FROM OLD.steal_blocked_until THEN RAISE EXCEPTION 'forbidden: steal_blocked_until'; END IF;
  IF NEW.armor_last_bought_at IS DISTINCT FROM OLD.armor_last_bought_at THEN RAISE EXCEPTION 'forbidden: armor_last_bought_at'; END IF;
  IF NEW.bg_burned_until IS DISTINCT FROM OLD.bg_burned_until THEN RAISE EXCEPTION 'forbidden: bg_burned_until'; END IF;
  IF NEW.active_session_id IS DISTINCT FROM OLD.active_session_id THEN RAISE EXCEPTION 'forbidden: active_session_id'; END IF;
  IF NEW.media_banned IS DISTINCT FROM OLD.media_banned THEN RAISE EXCEPTION 'forbidden: media_banned'; END IF;

  RETURN NEW;
END $function$;
