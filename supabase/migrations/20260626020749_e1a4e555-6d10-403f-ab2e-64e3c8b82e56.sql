CREATE OR REPLACE FUNCTION public.golden_fisher_tick(_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ship record;
  _pool jsonb;
  _pool_len int;
  _chosen text;
  _qty int;
  _unit_value bigint;
  _ships_processed int := 0;
  _total_cycles int := 0;
  _ships_launched int := 0;
  _total_fish bigint := 0;
  _now timestamptz := now();
  _elapsed numeric;
  _duration int;
  _active_until timestamptz;
  _luck_mult int;
  _has_luck boolean;
  _has_guide boolean;
  _guide_pref text;
  _ship_preferred text;
  _hp_ratio numeric;
BEGIN
  IF _user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_user');
  END IF;

  SELECT public.golden_fisher_active_until(_user) INTO _active_until;
  IF _active_until IS NULL OR _active_until <= _now THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_ends_at = NULL,
         stealing_started_at = NULL
   WHERE stealing_target_user_id = _user
      OR (user_id = _user AND stealing_target_user_id IS NOT NULL);

  FOR _ship IN
    SELECT
      s.*,
      c.fish_pool,
      c.fishing_seconds,
      c.storage,
      c.fishing_power
    FROM public.ships_owned s
    JOIN public.ship_catalog c ON c.code = s.catalog_code
    WHERE s.user_id = _user
      AND COALESCE(s.in_storage, false) = false
      AND s.destroyed_at IS NULL
      AND (s.repair_ends_at IS NULL OR s.repair_ends_at <= _now)
      AND s.stealing_target_user_id IS NULL
      AND s.stealing_ends_at IS NULL
    ORDER BY s.acquired_at NULLS LAST, s.id
  LOOP
    _hp_ratio := CASE WHEN COALESCE(_ship.max_hp, 0) > 0 THEN COALESCE(_ship.hp, _ship.max_hp)::numeric / _ship.max_hp::numeric ELSE 1 END;
    IF _hp_ratio < 0.30 THEN
      CONTINUE;
    END IF;

    _duration := GREATEST(30, COALESCE(_ship.fishing_seconds, 600));
    IF _ship.at_sea AND _ship.fishing_started_at IS NOT NULL THEN
      _elapsed := EXTRACT(EPOCH FROM (_now - _ship.fishing_started_at));
      IF _elapsed < _duration THEN
        CONTINUE;
      END IF;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.inventory inv
       WHERE inv.user_id = _user
         AND inv.item_type = 'crew'
         AND inv.item_id = 'luck'
         AND inv.quantity > 0
         AND inv.meta->>'assigned_ship_id' = _ship.id::text
         AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > _now)
    ) INTO _has_luck;
    _luck_mult := CASE WHEN _has_luck THEN 2 ELSE 1 END;

    _has_guide := false;
    _guide_pref := NULL;
    SELECT true, NULLIF(inv.meta->>'preferred_fish_id','')
      INTO _has_guide, _guide_pref
      FROM public.inventory inv
     WHERE inv.user_id = _user
       AND inv.item_type = 'crew'
       AND inv.item_id = 'guide'
       AND inv.meta->>'assigned_ship_id' = _ship.id::text
       AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > _now)
     LIMIT 1;
    _has_guide := COALESCE(_has_guide, false);

    _pool := COALESCE(_ship.fish_pool, '[]'::jsonb);
    _pool_len := jsonb_array_length(_pool);
    IF _pool_len <= 0 THEN
      UPDATE public.ships_owned
         SET at_sea = true,
             fishing_started_at = _now,
             last_fishing_reward_at = _now
       WHERE id = _ship.id;
      _ships_processed := _ships_processed + 1;
      _ships_launched := _ships_launched + 1;
      CONTINUE;
    END IF;

    _ship_preferred := NULL;
    IF _has_guide AND _guide_pref IS NOT NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _guide_pref
    ) THEN
      _ship_preferred := _guide_pref;
    ELSIF NULLIF(_ship.preferred_fish_id, '') IS NOT NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _ship.preferred_fish_id
    ) THEN
      _ship_preferred := _ship.preferred_fish_id;
    END IF;

    IF _ship_preferred IS NOT NULL THEN
      _chosen := _ship_preferred;
    ELSE
      SELECT p.value INTO _chosen
        FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
       WHERE p.ord = (1 + (abs(hashtextextended(_ship.id::text || ':' || COALESCE(_ship.fishing_started_at, _now)::text, 71003)) % _pool_len))
       LIMIT 1;
    END IF;

    IF _has_guide AND _guide_pref IS NOT NULL AND _ship.preferred_fish_id IS DISTINCT FROM _guide_pref THEN
      UPDATE public.ships_owned SET preferred_fish_id = _guide_pref WHERE id = _ship.id;
    END IF;

    _qty := GREATEST(1, COALESCE(_ship.storage, _ship.fishing_power, 1)) * _luck_mult;

    SELECT COALESCE(current_price, 0)::bigint INTO _unit_value
      FROM public.fish_market_prices
     WHERE fish_id = _chosen
     LIMIT 1;
    _unit_value := COALESCE(_unit_value, 0);

    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    VALUES (_user, _chosen, _qty, _qty)
    ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE
      SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
          total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught;

    INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
    VALUES (_user, _chosen, _ship.id, _now, _unit_value, _qty);

    INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
    VALUES (_user, _chosen, _now, _qty);

    UPDATE public.ships_owned
       SET at_sea = true,
           fishing_started_at = _now,
           last_fishing_reward_at = _now
     WHERE id = _ship.id;

    _ships_processed := _ships_processed + 1;
    _ships_launched := _ships_launched + 1;
    _total_cycles := _total_cycles + 1;
    _total_fish := _total_fish + _qty;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'ships_processed', _ships_processed,
    'launched', _ships_launched,
    'cycles', _total_cycles,
    'fish_added', _total_fish,
    'waiting_for_space', 0,
    'market_full', false
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) TO service_role;