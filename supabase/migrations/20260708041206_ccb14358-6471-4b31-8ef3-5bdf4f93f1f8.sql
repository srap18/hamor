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

  -- Reset the fishing timer for ALL eligible ships (including ones already
  -- at_sea). Previously the WHERE clause excluded ships already fishing,
  -- so the immediate golden_fisher_tick() call could grant a free cycle
  -- against their pre-activation timer ("السفن تطلع جاهزة").
  UPDATE public.ships_owned s
     SET at_sea = true,
         fishing_started_at = now(),
         last_fishing_reward_at = now()
    FROM public.ship_catalog c
   WHERE c.code = s.catalog_code
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

CREATE OR REPLACE FUNCTION public.remove_golden_fisher()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Clear active state + pause flag so the user can re-activate cleanly.
  UPDATE public.profiles
     SET golden_fisher_until = NULL,
         golden_fisher_last_activated_at = NULL,
         golden_fisher_paused = false,
         golden_fisher_no_shield = false
   WHERE id = _uid;

  -- Dock all fishing ships. Any fish already stored in fish_stock stays
  -- intact — we only clear the ship's live timer so it doesn't stay in a
  -- half-fishing state that later voids the next catch.
  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         last_fishing_reward_at = NULL
   WHERE user_id = _uid
     AND COALESCE(in_storage, false) = false
     AND stealing_target_user_id IS NULL
     AND stealing_ends_at IS NULL;

  RETURN jsonb_build_object('ok', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.activate_golden_fisher() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.activate_golden_fisher() FROM anon;
GRANT EXECUTE ON FUNCTION public.activate_golden_fisher() TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_golden_fisher() TO service_role;

REVOKE EXECUTE ON FUNCTION public.remove_golden_fisher() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.remove_golden_fisher() FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_golden_fisher() TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_golden_fisher() TO service_role;