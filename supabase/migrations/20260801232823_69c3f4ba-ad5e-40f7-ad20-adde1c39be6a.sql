-- 1) Whitelist-based profile guard (replaces the blacklist approach)
CREATE OR REPLACE FUNCTION public.guard_profiles_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _is_admin_user boolean := false;
  _allowed text[] := ARRAY[
    'display_name','avatar_emoji','avatar_url','avatar_frame','name_frame',
    'bubble_frame','profile_frame','selected_bg_id','bio','album_privacy'
  ];
  _new jsonb;
  _old jsonb;
  _merged jsonb;
  _k text;
BEGIN
  IF auth.role() = 'service_role'
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

  -- Loud errors for the classic cheat targets (keeps existing behaviour/messages)
  IF NEW.level IS DISTINCT FROM OLD.level THEN RAISE EXCEPTION 'forbidden: level'; END IF;
  IF NEW.xp IS DISTINCT FROM OLD.xp THEN RAISE EXCEPTION 'forbidden: xp'; END IF;
  IF NEW.weekly_xp IS DISTINCT FROM OLD.weekly_xp THEN RAISE EXCEPTION 'forbidden: weekly_xp'; END IF;
  IF NEW.coins IS DISTINCT FROM OLD.coins THEN RAISE EXCEPTION 'forbidden: coins'; END IF;
  IF NEW.gems IS DISTINCT FROM OLD.gems THEN RAISE EXCEPTION 'forbidden: gems'; END IF;
  IF NEW.rubies IS DISTINCT FROM OLD.rubies THEN RAISE EXCEPTION 'forbidden: rubies'; END IF;
  IF NEW.tribe_gems IS DISTINCT FROM OLD.tribe_gems THEN RAISE EXCEPTION 'forbidden: tribe_gems'; END IF;
  IF NEW.tribe_id IS DISTINCT FROM OLD.tribe_id THEN RAISE EXCEPTION 'forbidden: tribe_id'; END IF;
  IF NEW.vip_level IS DISTINCT FROM OLD.vip_level THEN RAISE EXCEPTION 'forbidden: vip_level'; END IF;
  IF NEW.vip_points IS DISTINCT FROM OLD.vip_points THEN RAISE EXCEPTION 'forbidden: vip_points'; END IF;
  IF NEW.elite_vip_level IS DISTINCT FROM OLD.elite_vip_level THEN RAISE EXCEPTION 'forbidden: elite_vip_level'; END IF;
  IF NEW.protection_until IS DISTINCT FROM OLD.protection_until THEN RAISE EXCEPTION 'forbidden: protection_until'; END IF;
  IF NEW.steal_blocked_until IS DISTINCT FROM OLD.steal_blocked_until THEN RAISE EXCEPTION 'forbidden: steal_blocked_until'; END IF;
  IF NEW.golden_fisher_until IS DISTINCT FROM OLD.golden_fisher_until THEN RAISE EXCEPTION 'forbidden: golden_fisher_until'; END IF;
  IF NEW.username IS DISTINCT FROM OLD.username THEN RAISE EXCEPTION 'forbidden: username (use change_username RPC)'; END IF;
  IF NEW.media_banned IS DISTINCT FROM OLD.media_banned THEN RAISE EXCEPTION 'forbidden: media_banned'; END IF;
  IF NEW.storage_capacity IS DISTINCT FROM OLD.storage_capacity THEN RAISE EXCEPTION 'forbidden: storage_capacity'; END IF;
  IF NEW.skill_points IS DISTINCT FROM OLD.skill_points THEN RAISE EXCEPTION 'forbidden: skill_points'; END IF;
  IF NEW.total_damage_dealt IS DISTINCT FROM OLD.total_damage_dealt THEN RAISE EXCEPTION 'forbidden: total_damage_dealt'; END IF;

  -- Catch-all: silently revert every column that is not explicitly client-editable.
  _new := to_jsonb(NEW);
  _old := to_jsonb(OLD);
  _merged := _old;
  FOREACH _k IN ARRAY _allowed LOOP
    _merged := jsonb_set(_merged, ARRAY[_k], COALESCE(_new -> _k, 'null'::jsonb));
  END LOOP;
  NEW := jsonb_populate_record(NEW, _merged);

  RETURN NEW;
END;
$function$;

-- 2) Hide private session / phone data from other players (column-level privileges)
DO $$
DECLARE
  _hidden text[] := ARRAY['active_session_ip','active_session_ua','active_session_id',
                          'phone_verified_at','phone_reward_claimed_at'];
  _cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO _cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'profiles'
    AND NOT (column_name = ANY(_hidden));

  EXECUTE 'REVOKE SELECT ON public.profiles FROM authenticated, anon';
  EXECUTE format('GRANT SELECT (%s) ON public.profiles TO authenticated, anon', _cols);
END $$;

GRANT ALL ON public.profiles TO service_role;