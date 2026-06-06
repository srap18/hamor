
-- SECURITY FIX: profiles_update_self allowed users to update ANY column on their row,
-- including gems, coins, rubies, vip_points, level, xp, protection_until, etc.
-- Replace it with a strict column-level allowlist enforced by a trigger.

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;

-- Recreate self-update policy (still scoped to own row)
CREATE POLICY profiles_update_self ON public.profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Trigger that blocks non-admin self-updates from changing sensitive fields.
CREATE OR REPLACE FUNCTION public.guard_profiles_self_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_service boolean := (auth.role() = 'service_role');
  is_admin_user boolean := false;
BEGIN
  -- Service role and SECURITY DEFINER functions (which run as table owner) bypass.
  IF is_service OR session_user = 'postgres' THEN
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

  -- Non-admin: forbid changes to any sensitive/economy/protection column.
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
  IF NEW.tribe_id IS DISTINCT FROM OLD.tribe_id THEN RAISE EXCEPTION 'forbidden: tribe_id'; END IF;
  IF NEW.username IS DISTINCT FROM OLD.username THEN RAISE EXCEPTION 'forbidden: username (use rpc)'; END IF;
  IF NEW.username_changed_at IS DISTINCT FROM OLD.username_changed_at THEN RAISE EXCEPTION 'forbidden: username_changed_at'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'forbidden: id'; END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'forbidden: created_at'; END IF;
  IF NEW.last_destroyer_id IS DISTINCT FROM OLD.last_destroyer_id THEN RAISE EXCEPTION 'forbidden: last_destroyer_id'; END IF;
  IF NEW.last_destroyer_at IS DISTINCT FROM OLD.last_destroyer_at THEN RAISE EXCEPTION 'forbidden: last_destroyer_at'; END IF;
  IF NEW.last_destroyer_kind IS DISTINCT FROM OLD.last_destroyer_kind THEN RAISE EXCEPTION 'forbidden: last_destroyer_kind'; END IF;
  IF NEW.last_destroyer_name IS DISTINCT FROM OLD.last_destroyer_name THEN RAISE EXCEPTION 'forbidden: last_destroyer_name'; END IF;
  IF NEW.last_destroyer_message IS DISTINCT FROM OLD.last_destroyer_message THEN RAISE EXCEPTION 'forbidden: last_destroyer_message'; END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profiles_self_update ON public.profiles;
CREATE TRIGGER trg_guard_profiles_self_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.guard_profiles_self_update();
