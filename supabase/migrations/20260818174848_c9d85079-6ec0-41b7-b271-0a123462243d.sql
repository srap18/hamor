CREATE OR REPLACE FUNCTION public.remove_golden_fisher()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ship record;
  _harvested int := 0;
  _market_full boolean := false;
  _vip6 boolean := false;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  _vip6 := public.elite_vip6_active(_uid);

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

  IF _vip6 THEN
    -- Elite VIP 6 keeps Golden Fisher permanently: pause instead of deleting,
    -- otherwise the perk is lost with no way to get it back.
    UPDATE public.profiles p
       SET golden_fisher_paused = true,
           golden_fisher_until = GREATEST(
             COALESCE(p.golden_fisher_until, '-infinity'::timestamptz),
             COALESCE(p.elite_vip_expires_at, 'infinity'::timestamptz)
           )
     WHERE p.id = _uid;
  ELSE
    UPDATE public.profiles
       SET golden_fisher_until = NULL,
           golden_fisher_last_activated_at = NULL,
           golden_fisher_paused = false,
           golden_fisher_no_shield = false
     WHERE id = _uid;
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         last_fishing_reward_at = NULL
   WHERE user_id = _uid
     AND COALESCE(in_storage, false) = false
     AND stealing_target_user_id IS NULL
     AND stealing_ends_at IS NULL
     AND NOT (COALESCE(at_sea, false) = true AND fishing_started_at IS NOT NULL);

  RETURN jsonb_build_object('ok', true, 'harvested', _harvested, 'market_full', _market_full, 'vip6_paused', _vip6);
END;
$function$;

CREATE OR REPLACE FUNCTION public.activate_golden_fisher()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record; _current timestamptz; _new_until timestamptz;
  _had_inventory boolean := false; _tick jsonb; _is_admin boolean; _vip6 boolean;
  _vip_exp timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM public._require_market_level(10);

  SELECT public.has_role(_uid, 'admin'::public.app_role) INTO _is_admin;
  _is_admin := COALESCE(_is_admin, false);
  _vip6 := public.elite_vip6_active(_uid);

  SELECT golden_fisher_until, elite_vip_expires_at INTO _current, _vip_exp
    FROM public.profiles WHERE id = _uid FOR UPDATE;

  -- VIP 6 owns Golden Fisher permanently: re-activating just resumes it.
  IF _vip6 THEN
    _new_until := GREATEST(
      COALESCE(_current, '-infinity'::timestamptz),
      COALESCE(_vip_exp, 'infinity'::timestamptz)
    );
  ELSE
    IF _current IS NOT NULL AND _current > now() AND NOT _is_admin THEN
      RAISE EXCEPTION 'golden_fisher_already_active';
    END IF;

    SELECT * INTO _row FROM public.inventory
     WHERE user_id = _uid AND item_type = 'crew' AND item_id = 'golden_fisher'
       AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL) AND quantity > 0
     ORDER BY acquired_at ASC FOR UPDATE LIMIT 1;

    IF _row.id IS NOT NULL THEN
      _had_inventory := true;
      IF _row.quantity <= 1 THEN DELETE FROM public.inventory WHERE id = _row.id;
      ELSE UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id; END IF;
      _new_until := now() + interval '24 hours';
    ELSE
      IF _is_admin THEN
        _new_until := GREATEST(COALESCE(_current, now()), now()) + interval '24 hours';
      ELSE
        RAISE EXCEPTION 'no_golden_fisher_in_inventory';
      END IF;
    END IF;
  END IF;

  UPDATE public.profiles
     SET golden_fisher_until = _new_until,
         golden_fisher_last_activated_at = now(),
         golden_fisher_paused = false,
         golden_fisher_no_shield = true
   WHERE id = _uid;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL,
         stealing_ends_at = NULL, stealing_started_at = NULL
   WHERE stealing_target_user_id = _uid;

  UPDATE public.ships_owned s
     SET at_sea = true,
         fishing_started_at = CASE
           WHEN COALESCE(s.at_sea, false) AND s.fishing_started_at IS NOT NULL
             THEN GREATEST(s.fishing_started_at,
                           now() - make_interval(secs => GREATEST(30, COALESCE(c.fishing_seconds, 600))::double precision))
           ELSE now()
         END,
         last_fishing_reward_at = CASE
           WHEN COALESCE(s.at_sea, false) AND s.fishing_started_at IS NOT NULL
             THEN GREATEST(COALESCE(s.last_fishing_reward_at, s.fishing_started_at),
                           now() - make_interval(secs => GREATEST(30, COALESCE(c.fishing_seconds, 600))::double precision))
           ELSE now()
         END
    FROM public.ship_catalog c
   WHERE c.code = COALESCE(NULLIF(s.catalog_code, ''), 'ship-lvl-' || COALESCE(s.template_id, 1)::text)
     AND c.active = true
     AND s.user_id = _uid AND s.in_storage = false AND s.destroyed_at IS NULL
     AND (s.repair_ends_at IS NULL OR s.repair_ends_at <= now())
     AND s.stealing_target_user_id IS NULL AND s.stealing_ends_at IS NULL;

  _tick := public.golden_fisher_tick(_uid);

  RETURN jsonb_build_object(
    'ok', true,
    'already_active', false,
    'extended', false,
    'admin_test', (_is_admin AND NOT _had_inventory),
    'vip6', _vip6,
    'until', _new_until,
    'tick', _tick
  );
END;
$function$;

-- Restore the perk for VIP 6 players who lost it by removing it earlier.
UPDATE public.profiles p
   SET golden_fisher_until = COALESCE(p.elite_vip_expires_at, 'infinity'::timestamptz)
 WHERE COALESCE(p.elite_vip_level, 0) >= 6
   AND (p.elite_vip_expires_at IS NULL OR p.elite_vip_expires_at > now())
   AND (p.golden_fisher_until IS NULL OR p.golden_fisher_until <= now());