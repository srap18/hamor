CREATE OR REPLACE FUNCTION public.claim_steal_mission(_attacker_ship_id uuid, _force boolean DEFAULT false)
 RETURNS TABLE(stolen_count integer, total_value bigint, fish_summary jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _ship public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _pool jsonb;
  _max integer; _existing integer; _remaining_cap integer;
  _market_remaining bigint;
  _scaled integer; _moved integer := 0; _value bigint := 0;
  _ratio numeric := 1; _duration numeric; _elapsed numeric;
  _target_ship_id uuid; _target_user_id uuid;
  _remaining integer; _take integer; _row record;
  _summary jsonb := '[]'::jsonb;
  _agg jsonb;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _ship FROM public.ships_owned
   WHERE id = _attacker_ship_id AND user_id = _me FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _ship.stealing_target_user_id IS NULL THEN
    RAISE EXCEPTION 'no active steal mission';
  END IF;

  IF NOT _force AND (_ship.stealing_ends_at IS NULL OR _ship.stealing_ends_at > now()) THEN
    RAISE EXCEPTION 'mission not finished';
  END IF;

  _target_ship_id := _ship.stealing_target_ship_id;
  _target_user_id := _ship.stealing_target_user_id;

  -- Ratio: 1 on natural completion; proportional on forced early end.
  IF _force AND _ship.fishing_started_at IS NOT NULL AND _ship.stealing_ends_at IS NOT NULL AND _ship.stealing_ends_at > now() THEN
    _duration := GREATEST(1, EXTRACT(EPOCH FROM (_ship.stealing_ends_at - _ship.fishing_started_at)));
    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (LEAST(now(), _ship.stealing_ends_at) - _ship.fishing_started_at)));
    _ratio := LEAST(1, _elapsed / _duration);
  ELSE
    _ratio := 1;
  END IF;

  SELECT * INTO _cat FROM public.ship_catalog WHERE code = _ship.catalog_code;
  _max := GREATEST(1, CASE WHEN COALESCE(_ship.template_id, 0) = 32
                           THEN COALESCE(_ship.max_hp, _cat.storage, 10)
                           ELSE COALESCE(_cat.storage, 10) END);

  SELECT COALESCE(SUM(GREATEST(0, quantity)), 0)::int INTO _existing
    FROM public.fish_stock WHERE user_id = _me AND ship_id = _attacker_ship_id;
  _remaining_cap := GREATEST(0, _max - _existing);
  _market_remaining := public.user_market_remaining(_me);
  _scaled := LEAST(FLOOR(_max * _ratio)::int, _remaining_cap);
  _scaled := LEAST(_scaled::bigint, _market_remaining)::int;
  IF _scaled < 0 THEN _scaled := 0; END IF;

  IF _scaled > 0 THEN
    _remaining := _scaled;

    SELECT sc.fish_pool INTO _pool
    FROM public.ships_owned so JOIN public.ship_catalog sc ON sc.code = so.catalog_code
    WHERE so.id = _target_ship_id AND so.user_id = _target_user_id;
    IF _pool IS NULL THEN _pool := '[]'::jsonb; END IF;

    FOR _row IN
      WITH pool_ids AS (SELECT jsonb_array_elements_text(_pool) AS fid)
      SELECT fs.id, fs.fish_id, fs.base_value, GREATEST(0, COALESCE(fs.quantity, 1))::int AS quantity
      FROM public.fish_stock fs
      WHERE fs.user_id = _target_user_id
        AND fs.fish_id IN (SELECT fid FROM pool_ids)
        AND GREATEST(0, COALESCE(fs.quantity, 1)) > 0
      ORDER BY fs.base_value DESC, fs.caught_at ASC FOR UPDATE SKIP LOCKED
    LOOP
      EXIT WHEN _remaining <= 0;
      _take := LEAST(_remaining, _row.quantity);
      IF _take <= 0 THEN CONTINUE; END IF;
      IF _take >= _row.quantity THEN DELETE FROM public.fish_stock WHERE id = _row.id;
      ELSE UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _row.id;
      END IF;
      INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
      VALUES (_me, _row.fish_id, _attacker_ship_id, now(), _row.base_value, _take);
      _moved := _moved + _take;
      _value := _value + (_take::bigint * COALESCE(_row.base_value, 0));
      _summary := _summary || jsonb_build_object('fish_id', _row.fish_id, 'value', _row.base_value, 'qty', _take);
      _remaining := _remaining - _take;
    END LOOP;

    IF _remaining > 0 THEN
      FOR _row IN
        SELECT fs.id, fs.fish_id, fs.base_value, GREATEST(0, COALESCE(fs.quantity, 1))::int AS quantity
        FROM public.fish_stock fs
        WHERE fs.user_id = _target_user_id
          AND GREATEST(0, COALESCE(fs.quantity, 1)) > 0
        ORDER BY fs.base_value DESC, fs.caught_at ASC FOR UPDATE SKIP LOCKED
      LOOP
        EXIT WHEN _remaining <= 0;
        _take := LEAST(_remaining, _row.quantity);
        IF _take <= 0 THEN CONTINUE; END IF;
        IF _take >= _row.quantity THEN DELETE FROM public.fish_stock WHERE id = _row.id;
        ELSE UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _row.id;
        END IF;
        INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
        VALUES (_me, _row.fish_id, _attacker_ship_id, now(), _row.base_value, _take);
        _moved := _moved + _take;
        _value := _value + (_take::bigint * COALESCE(_row.base_value, 0));
        _summary := _summary || jsonb_build_object('fish_id', _row.fish_id, 'value', _row.base_value, 'qty', _take);
        _remaining := _remaining - _take;
      END LOOP;
    END IF;
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
   WHERE id = _attacker_ship_id;
  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL
   WHERE id = _target_ship_id AND user_id = _target_user_id;

  RETURN QUERY SELECT _moved, _value, _summary;
END;
$function$;