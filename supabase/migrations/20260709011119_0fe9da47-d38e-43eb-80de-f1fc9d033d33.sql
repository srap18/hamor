CREATE OR REPLACE FUNCTION public.activate_golden_fisher()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record; _current timestamptz; _new_until timestamptz;
  _had_inventory boolean := false; _tick jsonb; _is_admin boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM public._require_market_level(10);

  SELECT public.has_role(_uid, 'admin'::public.app_role) INTO _is_admin;
  _is_admin := COALESCE(_is_admin, false);

  SELECT golden_fisher_until INTO _current FROM public.profiles WHERE id = _uid FOR UPDATE;

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

  -- Keep any already-sailing fishing trip alive. The old version reset
  -- fishing_started_at to now for every ship, which erased in-progress catches
  -- when Golden Fisher was activated while ships were already at sea.
  UPDATE public.ships_owned s
     SET at_sea = true,
         fishing_started_at = COALESCE(s.fishing_started_at, now()),
         last_fishing_reward_at = CASE
           WHEN COALESCE(s.at_sea, false) AND s.fishing_started_at IS NOT NULL
             THEN COALESCE(s.last_fishing_reward_at, s.fishing_started_at)
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
    'until', _new_until,
    'tick', _tick
  );
END;
$function$;

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

  -- Collect pending fish before pausing so stopping Golden Fisher never wipes
  -- a sailing trip without reward. If the fish market is full, keep that ship
  -- at sea instead of deleting its timer.
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

  UPDATE public.profiles SET golden_fisher_paused = true WHERE id = _uid;

  -- Dock idle/non-fishing ships. Ships that could not be harvested because the
  -- market is full keep their fishing_started_at so the catch is not lost.
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
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Collect pending fish before removing so the active trip is not erased.
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

  -- Clear active state + pause flag so the user can re-activate cleanly.
  UPDATE public.profiles
     SET golden_fisher_until = NULL,
         golden_fisher_last_activated_at = NULL,
         golden_fisher_paused = false,
         golden_fisher_no_shield = false
   WHERE id = _uid;

  -- Dock only ships that are already harvested/idle. Do not wipe still-fishing
  -- timers when the fish market is full.
  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         last_fishing_reward_at = NULL
   WHERE user_id = _uid
     AND COALESCE(in_storage, false) = false
     AND stealing_target_user_id IS NULL
     AND stealing_ends_at IS NULL
     AND NOT (COALESCE(at_sea, false) = true AND fishing_started_at IS NOT NULL);

  RETURN jsonb_build_object('ok', true, 'harvested', _harvested, 'market_full', _market_full);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_ship_at_sea(_ship_id uuid, _at_sea boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _ratio numeric;
  _golden_active boolean := false;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Bot detection BEFORE work; if it bans the user, fail their action
  PERFORM public._detect_bot_and_ban(_uid, CASE WHEN _at_sea THEN 'ship_start' ELSE 'ship_stop' END);
  IF EXISTS (SELECT 1 FROM public.bans WHERE user_id = _uid AND active = true
             AND (expires_at IS NULL OR expires_at > now())) THEN
    RAISE EXCEPTION 'banned_bot_detected';
  END IF;

  SELECT user_id, at_sea, fishing_started_at, destroyed_at, repair_ends_at
    INTO _row
    FROM public.ships_owned
   WHERE id = _ship_id
   FOR UPDATE;

  IF _row.user_id IS NULL OR _row.user_id <> _uid THEN
    RAISE EXCEPTION 'not your ship';
  END IF;

  IF _at_sea AND _row.destroyed_at IS NOT NULL AND _row.repair_ends_at IS NOT NULL AND _row.repair_ends_at > now() THEN
    _ratio := public._ship_repair_ratio(_row.destroyed_at, _row.repair_ends_at);
    IF _ratio < 0.30 THEN
      UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL WHERE id = _ship_id;
      RAISE EXCEPTION 'ship_destroyed';
    END IF;
  END IF;

  IF _at_sea THEN
    IF COALESCE(_row.at_sea, false) AND _row.fishing_started_at IS NOT NULL THEN
      RETURN;
    END IF;
    UPDATE public.ships_owned
       SET at_sea = true,
           fishing_started_at = now()
     WHERE id = _ship_id;
  ELSE
    SELECT COALESCE(public.golden_fisher_active_until(_uid) > now(), false)
      INTO _golden_active;

    -- During Golden Fisher, manual stop must harvest first. If market is full
    -- collect_fishing_reward raises and the timer remains untouched, preventing
    -- the “stopped with no fish” loss.
    IF _golden_active AND COALESCE(_row.at_sea, false) AND _row.fishing_started_at IS NOT NULL THEN
      PERFORM 1 FROM public.collect_fishing_reward(_ship_id, NULL::text, NULL::integer);
      RETURN;
    END IF;

    UPDATE public.ships_owned
       SET at_sea = false,
           fishing_started_at = NULL
     WHERE id = _ship_id;
  END IF;
END;
$function$;