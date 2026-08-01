CREATE OR REPLACE FUNCTION public.claim_session(_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.bans
    WHERE user_id = _uid
      AND active = true
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RAISE EXCEPTION 'banned';
  END IF;

  UPDATE public.profiles
     SET active_session_id = _token,
         active_session_started_at = now()
   WHERE id = _uid;

  INSERT INTO public.player_sessions (user_id, ip, ua, started_at, updated_at)
  VALUES (_uid, public._client_ip(), public._client_ua(), now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET ip = EXCLUDED.ip, ua = EXCLUDED.ua, started_at = now(), updated_at = now();
END;
$fn$;

CREATE OR REPLACE FUNCTION public.guard_profiles_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.role() = 'service_role'
     OR current_user IN ('postgres','supabase_admin','service_role','supabase_auth_admin')
     OR session_user IN ('postgres','supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR NEW.id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'forbidden: profile owner only';
  END IF;

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
  NEW.active_session_started_at := NULL;
  NEW.created_at := now();
  NEW.online_at := now();

  RETURN NEW;
END;
$fn$;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS active_session_ip;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS active_session_ua;