-- Emergency hardening: stop client-side privilege/rank/currency/VIP tampering

-- 1) Lock direct Data API grants on the most sensitive tables.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.user_roles FROM anon, authenticated, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.ships_owned FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.inventory FROM anon, PUBLIC;

-- Authenticated users still need to update safe profile display fields through RLS + trigger guard.
GRANT UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT ALL ON TABLE public.user_roles TO service_role;

-- 2) SECURITY DEFINER helpers that are only meant to be called by other trusted RPCs/webhooks
-- must not be directly executable from browser clients.
REVOKE ALL ON FUNCTION public._mutate_currency(uuid, bigint, integer, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_vip_points(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._grant_ship_with_storage(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_vip_protection(uuid) FROM PUBLIC, anon, authenticated;

-- 3) Remove anonymous access to admin SECURITY DEFINER RPCs that were accidentally callable by anon/public.
REVOKE ALL ON FUNCTION public.admin_get_player_inventory(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_grant_inventory_item(uuid, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_inventory_quantity(uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_get_player_inventory(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_grant_inventory_item(uuid, text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_inventory_quantity(uuid, integer) TO authenticated, service_role;

-- 4) Fix privileged-caller detection. Anonymous direct calls must never be treated as privileged.
CREATE OR REPLACE FUNCTION public.is_privileged_caller()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _role text := current_user;
  _uid uuid;
BEGIN
  -- Direct API calls run as anon/authenticated and must be checked by user role.
  IF _role IN ('authenticated','anon') THEN
    _uid := auth.uid();
    IF _uid IS NULL THEN
      RETURN false;
    END IF;
    BEGIN
      RETURN public.is_admin(_uid);
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
  END IF;

  -- SECURITY DEFINER/server-owned execution only.
  RETURN true;
END;
$$;

-- 5) Strict profile guard: browser clients may only change cosmetic/safe profile fields.
CREATE OR REPLACE FUNCTION public.guard_profiles_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  _is_service boolean := (auth.role() = 'service_role');
  _is_admin_user boolean := false;
BEGIN
  IF _is_service
     OR current_user IN ('postgres','supabase_admin','service_role','supabase_auth_admin')
     OR session_user IN ('postgres','supabase_admin') THEN
    RETURN NEW;
  END IF;

  BEGIN
    _is_admin_user := public.is_admin(auth.uid());
  EXCEPTION WHEN OTHERS THEN
    _is_admin_user := false;
  END;

  IF _is_admin_user THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> OLD.id OR auth.uid() <> NEW.id THEN
    RAISE EXCEPTION 'forbidden: profile owner only';
  END IF;

  IF NEW.level IS DISTINCT FROM OLD.level THEN RAISE EXCEPTION 'forbidden: level'; END IF;
  IF NEW.xp IS DISTINCT FROM OLD.xp THEN RAISE EXCEPTION 'forbidden: xp'; END IF;
  IF NEW.weekly_xp IS DISTINCT FROM OLD.weekly_xp THEN RAISE EXCEPTION 'forbidden: weekly_xp'; END IF;
  IF NEW.coins IS DISTINCT FROM OLD.coins THEN RAISE EXCEPTION 'forbidden: coins'; END IF;
  IF NEW.gems IS DISTINCT FROM OLD.gems THEN RAISE EXCEPTION 'forbidden: gems'; END IF;
  IF NEW.rubies IS DISTINCT FROM OLD.rubies THEN RAISE EXCEPTION 'forbidden: rubies'; END IF;
  IF NEW.tribe_gems IS DISTINCT FROM OLD.tribe_gems THEN RAISE EXCEPTION 'forbidden: tribe_gems'; END IF;
  IF NEW.tribe_id IS DISTINCT FROM OLD.tribe_id THEN RAISE EXCEPTION 'forbidden: tribe_id'; END IF;
  IF NEW.protection_until IS DISTINCT FROM OLD.protection_until THEN RAISE EXCEPTION 'forbidden: protection_until'; END IF;
  IF NEW.steal_blocked_until IS DISTINCT FROM OLD.steal_blocked_until THEN RAISE EXCEPTION 'forbidden: steal_blocked_until'; END IF;
  IF NEW.vip_level IS DISTINCT FROM OLD.vip_level THEN RAISE EXCEPTION 'forbidden: vip_level'; END IF;
  IF NEW.vip_points IS DISTINCT FROM OLD.vip_points THEN RAISE EXCEPTION 'forbidden: vip_points'; END IF;
  IF NEW.vip_expires_at IS DISTINCT FROM OLD.vip_expires_at THEN RAISE EXCEPTION 'forbidden: vip_expires_at'; END IF;
  IF NEW.vip_subs_claimed IS DISTINCT FROM OLD.vip_subs_claimed THEN RAISE EXCEPTION 'forbidden: vip_subs_claimed'; END IF;
  IF NEW.elite_vip_level IS DISTINCT FROM OLD.elite_vip_level THEN RAISE EXCEPTION 'forbidden: elite_vip_level'; END IF;
  IF NEW.elite_vip_expires_at IS DISTINCT FROM OLD.elite_vip_expires_at THEN RAISE EXCEPTION 'forbidden: elite_vip_expires_at'; END IF;
  IF NEW.bg_burned_until IS DISTINCT FROM OLD.bg_burned_until THEN RAISE EXCEPTION 'forbidden: bg_burned_until'; END IF;
  IF NEW.armor_last_bought_at IS DISTINCT FROM OLD.armor_last_bought_at THEN RAISE EXCEPTION 'forbidden: armor_last_bought_at'; END IF;
  IF NEW.last_destroyer_id IS DISTINCT FROM OLD.last_destroyer_id THEN RAISE EXCEPTION 'forbidden: last_destroyer_id'; END IF;
  IF NEW.last_destroyer_name IS DISTINCT FROM OLD.last_destroyer_name THEN RAISE EXCEPTION 'forbidden: last_destroyer_name'; END IF;
  IF NEW.last_destroyer_kind IS DISTINCT FROM OLD.last_destroyer_kind THEN RAISE EXCEPTION 'forbidden: last_destroyer_kind'; END IF;
  IF NEW.last_destroyer_at IS DISTINCT FROM OLD.last_destroyer_at THEN RAISE EXCEPTION 'forbidden: last_destroyer_at'; END IF;
  IF NEW.last_destroyer_message IS DISTINCT FROM OLD.last_destroyer_message THEN RAISE EXCEPTION 'forbidden: last_destroyer_message'; END IF;
  IF NEW.media_banned IS DISTINCT FROM OLD.media_banned THEN RAISE EXCEPTION 'forbidden: media_banned'; END IF;
  IF NEW.username IS DISTINCT FROM OLD.username THEN RAISE EXCEPTION 'forbidden: username (use change_username RPC)'; END IF;
  IF NEW.username_changed_at IS DISTINCT FROM OLD.username_changed_at THEN RAISE EXCEPTION 'forbidden: username_changed_at'; END IF;
  IF NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN RAISE EXCEPTION 'forbidden: referral_code'; END IF;
  IF NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN RAISE EXCEPTION 'forbidden: referred_by'; END IF;
  IF NEW.referral_locked_at IS DISTINCT FROM OLD.referral_locked_at THEN RAISE EXCEPTION 'forbidden: referral_locked_at'; END IF;
  IF NEW.golden_fisher_until IS DISTINCT FROM OLD.golden_fisher_until THEN RAISE EXCEPTION 'forbidden: golden_fisher_until'; END IF;
  IF NEW.golden_fisher_last_activated_at IS DISTINCT FROM OLD.golden_fisher_last_activated_at THEN RAISE EXCEPTION 'forbidden: golden_fisher_last_activated_at'; END IF;
  IF NEW.active_session_id IS DISTINCT FROM OLD.active_session_id THEN RAISE EXCEPTION 'forbidden: active_session_id'; END IF;
  IF NEW.active_session_ip IS DISTINCT FROM OLD.active_session_ip THEN RAISE EXCEPTION 'forbidden: active_session_ip'; END IF;
  IF NEW.active_session_ua IS DISTINCT FROM OLD.active_session_ua THEN RAISE EXCEPTION 'forbidden: active_session_ua'; END IF;
  IF NEW.active_session_started_at IS DISTINCT FROM OLD.active_session_started_at THEN RAISE EXCEPTION 'forbidden: active_session_started_at'; END IF;
  IF NEW.online_at IS DISTINCT FROM OLD.online_at THEN RAISE EXCEPTION 'forbidden: online_at'; END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'forbidden: created_at'; END IF;

  -- Safe client-editable fields are display_name, avatar_emoji, avatar_url,
  -- avatar_frame, name_frame, selected_bg_id, bubble_frame, profile_frame, bio, album_privacy, ship_flag.
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_profiles_self_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Keep legacy trigger name but delegate to the strict guard above.
  RETURN public.guard_profiles_update();
END;
$$;

-- 6) Ensure owner self-update RLS cannot be bypassed by broad PUBLIC policy semantics.
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS admin_update_profiles ON public.profiles;
CREATE POLICY admin_update_profiles
ON public.profiles
FOR UPDATE
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS user_roles_insert_admin_only ON public.user_roles;
DROP POLICY IF EXISTS admin_manage_roles ON public.user_roles;
CREATE POLICY admin_manage_roles
ON public.user_roles
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));