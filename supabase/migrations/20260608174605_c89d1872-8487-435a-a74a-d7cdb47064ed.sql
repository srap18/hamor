CREATE OR REPLACE FUNCTION public.golden_fisher_tick(_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ship record;
  _cat record;
  _pool jsonb;
  _pool_len int;
  _chosen text;
  _capacity int;
  _market_remaining bigint;
  _qty int;
  _unit_value bigint;
  _cycles int := 0;
  _ships_processed int := 0;
  _now timestamptz := now();
  _elapsed int;
  _full_cycles int;
  _is_active boolean;
BEGIN
  SELECT (
    (golden_fisher_until IS NOT NULL AND golden_fisher_until > _now)
    OR EXISTS (
      SELECT 1 FROM public.inventory i
      WHERE i.user_id = _user
        AND i.item_type = 'crew'
        AND i.item_id = 'golden_fisher'
        AND i.meta ? 'expires_at'
        AND (i.meta->>'expires_at')::timestamptz > _now
    )
  ) INTO _is_active
  FROM public.profiles WHERE id = _user;

  IF NOT COALESCE(_is_active, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  FOR _ship IN
    SELECT * FROM public.ships_owned
    WHERE user_id = _user
      AND in_storage = false
      AND destroyed_at IS NULL
      AND (repair_ends_at IS NULL OR repair_ends_at <= _now)
      AND stealing_target_user_id IS NULL
      AND stealing_ends_at IS NULL
    FOR UPDATE
  LOOP
    SELECT * INTO _cat
    FROM public.ship_catalog
    WHERE code = COALESCE(_ship.catalog_code, 'ship-lvl-' || COALESCE(_ship.template_id, 1))
      AND active = true
    LIMIT 1;

    IF _cat.id IS NULL THEN
      SELECT * INTO _cat
      FROM public.ship_catalog
      WHERE sort_order = COALESCE(_ship.template_id, 1)
        AND active = true
      ORDER BY market_level_required ASC
      LIMIT 1;
    END IF;

    IF _cat.id IS NULL THEN CONTINUE; END IF;

    _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
    _pool_len := jsonb_array_length(_pool);
    IF _pool_len = 0 OR COALESCE(_cat.fishing_seconds, 0) <= 0 THEN CONTINUE; END IF;

    IF _ship.fishing_started_at IS NULL THEN
      UPDATE public.ships_owned
         SET fishing_started_at = _now,
             at_sea = true
       WHERE id = _ship.id;
      _ships_processed := _ships_processed + 1;
      CONTINUE;
    END IF;

    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (_now - _ship.fishing_started_at))::int);
    _full_cycles := _elapsed / GREATEST(1, COALESCE(_cat.fishing_seconds, 30));

    IF _full_cycles <= 0 THEN
      UPDATE public.ships_owned
         SET at_sea = true
       WHERE id = _ship.id;
      _ships_processed := _ships_processed + 1;
      CONTINUE;
    END IF;

    IF _full_cycles > 20 THEN _full_cycles := 20; END IF;

    _capacity := GREATEST(1, CASE WHEN COALESCE(_ship.template_id, 0) = 32 THEN COALESCE(_ship.max_hp, _cat.storage, 10) ELSE COALESCE(_cat.storage, 10) END);

    FOR i IN 1.._full_cycles LOOP
      _market_remaining := public.user_market_remaining(_user);
      EXIT WHEN _market_remaining <= 0;

      _chosen := _pool->>floor(random() * _pool_len)::int;
      _qty := LEAST(_capacity::bigint, _market_remaining)::int;
      IF _qty < 1 THEN _qty := 1; END IF;

      INSERT INTO public.fish_caught (user_id, fish_id, quantity, total_caught, updated_at)
      VALUES (_user, _chosen, _qty, _qty, _now)
      ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE
        SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
            total_caught = public.fish_caught.total_caught + EXCLUDED.quantity,
            updated_at = _now;

      SELECT COALESCE(current_price, 0)::bigint INTO _unit_value
      FROM public.fish_market_prices
      WHERE fish_market_prices.fish_id = _chosen;

      INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
      VALUES (_user, _chosen, _ship.id, _now, COALESCE(_unit_value, 0), _qty);

      INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
      VALUES (_user, _chosen, _now, _qty);

      _cycles := _cycles + 1;
    END LOOP;

    UPDATE public.ships_owned
       SET fishing_started_at = _now,
           at_sea = true,
           last_fishing_reward_at = _now
     WHERE id = _ship.id;

    _ships_processed := _ships_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cycles', _cycles, 'ships', _ships_processed);
END
$function$;

GRANT EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.activate_golden_fisher()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _new_until timestamptz;
  _current timestamptz;
  _tick jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _row
  FROM public.inventory
  WHERE user_id = _uid
    AND item_type = 'crew'
    AND item_id = 'golden_fisher'
    AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL)
    AND quantity > 0
  ORDER BY acquired_at ASC
  FOR UPDATE
  LIMIT 1;

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'no_golden_fisher_in_inventory';
  END IF;

  IF _row.quantity <= 1 THEN
    DELETE FROM public.inventory WHERE id = _row.id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
  END IF;

  SELECT golden_fisher_until INTO _current FROM public.profiles WHERE id = _uid;
  _new_until := GREATEST(COALESCE(_current, now()), now()) + interval '24 hours';

  UPDATE public.profiles
    SET golden_fisher_until = _new_until,
        protection_until = GREATEST(COALESCE(protection_until, _new_until), _new_until)
    WHERE id = _uid;

  _tick := public.golden_fisher_tick(_uid);

  RETURN jsonb_build_object('ok', true, 'until', _new_until, 'tick', _tick);
END $$;

GRANT EXECUTE ON FUNCTION public.activate_golden_fisher() TO authenticated;