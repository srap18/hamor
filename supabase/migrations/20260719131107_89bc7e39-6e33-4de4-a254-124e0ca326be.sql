
-- 1) _mutate_currency: skip UPDATE + inserts when every delta is a true zero.
CREATE OR REPLACE FUNCTION public._mutate_currency(_user uuid, _coins bigint DEFAULT 0, _gems integer DEFAULT 0, _rubies integer DEFAULT 0, _xp integer DEFAULT 0)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _cur record;
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _scaled integer := 0;
  _today_count integer;
  _xp_delta integer := 0;
BEGIN
  SELECT coins, gems, rubies, xp, level, xp_today, xp_today_date
    INTO _cur FROM public.profiles WHERE id = _user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no profile'; END IF;
  IF _cur.coins  + _coins  < 0 THEN RAISE EXCEPTION 'insufficient coins'; END IF;
  IF _cur.gems   + _gems   < 0 THEN RAISE EXCEPTION 'insufficient gems'; END IF;
  IF _cur.rubies + _rubies < 0 THEN RAISE EXCEPTION 'insufficient rubies'; END IF;

  _xp_delta := COALESCE(_xp, 0);
  IF _xp_delta > 0 THEN
    _scaled := FLOOR(_xp_delta * public.xp_gain_scale(_cur.level))::integer;
    _xp_delta := GREATEST(0, _scaled);
    _today_count := CASE
      WHEN _cur.xp_today_date = _today THEN COALESCE(_cur.xp_today, 0)
      ELSE 0
    END;

    UPDATE public.profiles
       SET coins = coins + _coins,
           gems = gems + _gems,
           rubies = rubies + _rubies,
           xp = xp + _xp_delta,
           xp_today = LEAST(2147483647::bigint, _today_count::bigint + _xp_delta::bigint)::integer,
           xp_today_date = _today
     WHERE id = _user
       AND (_coins <> 0 OR _gems <> 0 OR _rubies <> 0 OR _xp_delta <> 0);
  ELSE
    -- No XP gain; write currency deltas only when at least one is non-zero.
    IF COALESCE(_coins,0) <> 0 OR COALESCE(_gems,0) <> 0 OR COALESCE(_rubies,0) <> 0 THEN
      UPDATE public.profiles
         SET coins = coins + _coins,
             gems = gems + _gems,
             rubies = rubies + _rubies,
             xp = GREATEST(0, xp + _xp_delta)
       WHERE id = _user;
    END IF;
  END IF;

  IF _coins <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind)
    VALUES (_user, _coins, 'coins', 'mutate');
  END IF;
  IF _gems <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind)
    VALUES (_user, _gems, 'gems', 'mutate');
  END IF;
  IF _rubies <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind)
    VALUES (_user, _rubies, 'rubies', 'mutate');
  END IF;
END;
$function$;

-- 2) set_friend_requests_closed: skip if unchanged.
CREATE OR REPLACE FUNCTION public.set_friend_requests_closed(p_closed boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  UPDATE public.profiles
     SET friend_requests_closed = COALESCE(p_closed, false)
   WHERE id = v_me
     AND friend_requests_closed IS DISTINCT FROM COALESCE(p_closed, false);
  RETURN COALESCE(p_closed, false);
END;
$function$;

-- 3) set_elite_vip_login_broadcast: skip if unchanged.
CREATE OR REPLACE FUNCTION public.set_elite_vip_login_broadcast(_enabled boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  UPDATE public.profiles
     SET elite_vip_login_broadcast_enabled = COALESCE(_enabled, true)
   WHERE id = auth.uid()
     AND elite_vip_login_broadcast_enabled IS DISTINCT FROM COALESCE(_enabled, true);
  RETURN COALESCE(_enabled, true);
END;
$function$;

-- 4) pause_golden_fisher: guard flag-only update.
CREATE OR REPLACE FUNCTION public.pause_golden_fisher()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _until timestamptz;
  _ship record;
  _harvested int := 0;
  _market_full boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT golden_fisher_until INTO _until FROM public.profiles WHERE id = _uid;
  IF _until IS NULL OR _until <= now() THEN
    RAISE EXCEPTION 'golden_fisher_not_active';
  END IF;

  FOR _ship IN
    SELECT id FROM public.ships_owned
     WHERE user_id = _uid
       AND COALESCE(in_storage, false) = false
       AND COALESCE(at_sea, false) = true
       AND fishing_started_at IS NOT NULL
       AND stealing_target_user_id IS NULL
       AND stealing_ends_at IS NULL
  LOOP
    BEGIN
      PERFORM 1 FROM public.collect_fishing_reward(_ship.id, NULL::text, NULL::integer);
      _harvested := _harvested + 1;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ILIKE '%market_full%' THEN
        _market_full := true;
      ELSE
        INSERT INTO public.golden_fisher_errors(user_id, ship_id, cycles, fish_added, remaining_storage, exec_ms, error)
        VALUES (_uid, _ship.id, 0, 0, public.user_market_remaining(_uid), 0, SQLERRM);
        UPDATE public.ships_owned
           SET at_sea = false, fishing_started_at = NULL, last_fishing_reward_at = NULL
         WHERE id = _ship.id;
      END IF;
    END;
  END LOOP;

  UPDATE public.profiles
     SET golden_fisher_paused = true
   WHERE id = _uid
     AND COALESCE(golden_fisher_paused, false) IS DISTINCT FROM true;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         last_fishing_reward_at = NULL
   WHERE user_id = _uid
     AND COALESCE(in_storage, false) = false
     AND stealing_target_user_id IS NULL
     AND stealing_ends_at IS NULL
     AND NOT (COALESCE(at_sea, false) = true AND fishing_started_at IS NOT NULL);

  RETURN jsonb_build_object('ok', true, 'paused', true, 'until', _until, 'harvested', _harvested, 'market_full', _market_full);
END;
$function$;

-- 5) resume_golden_fisher: guard flag-only update.
CREATE OR REPLACE FUNCTION public.resume_golden_fisher()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _until timestamptz;
  _tick jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT golden_fisher_until INTO _until FROM public.profiles WHERE id = _uid;
  IF _until IS NULL OR _until <= now() THEN
    RAISE EXCEPTION 'golden_fisher_not_active';
  END IF;

  UPDATE public.profiles
     SET golden_fisher_paused = false
   WHERE id = _uid
     AND COALESCE(golden_fisher_paused, false) IS DISTINCT FROM false;

  _tick := public.golden_fisher_tick(_uid);

  RETURN jsonb_build_object('ok', true, 'paused', false, 'until', _until, 'tick', _tick);
END;
$function$;

-- 6) set_my_tribe: skip when tribe_id already equal.
CREATE OR REPLACE FUNCTION public.set_my_tribe(_tribe_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _tribe_id IS NULL THEN
    UPDATE public.profiles SET tribe_id = NULL
     WHERE id = _uid AND tribe_id IS NOT NULL;
    RETURN;
  END IF;
  IF NOT public.is_tribe_member(_uid, _tribe_id) THEN
    RAISE EXCEPTION 'not a tribe member';
  END IF;
  UPDATE public.profiles SET tribe_id = _tribe_id
   WHERE id = _uid AND tribe_id IS DISTINCT FROM _tribe_id;
END $function$;
