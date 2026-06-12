CREATE OR REPLACE FUNCTION public.claim_steal_mission(_attacker_ship_id uuid, _force boolean DEFAULT false)
RETURNS TABLE(stolen_count integer, total_value bigint, fish_summary jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _ship public.ships_owned%ROWTYPE;
  _target_ship public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _target_cat public.ship_catalog%ROWTYPE;
  _pool jsonb;
  _target_pool jsonb;
  _pool_len integer;
  _generated_fish_id text;
  _unit_value bigint;
  _max integer;
  _existing integer;
  _remaining_cap integer;
  _market_remaining bigint;
  _scaled integer;
  _moved integer := 0;
  _value bigint := 0;
  _ratio numeric := 1;
  _duration numeric;
  _elapsed numeric;
  _start timestamptz;
  _target_ship_id uuid;
  _target_user_id uuid;
  _remaining integer;
  _take integer;
  _row record;
  _summary jsonb := '[]'::jsonb;
  _thief_name text;
  _thief_emoji text;
  _target_duration integer;
  _target_capacity integer;
  _target_elapsed numeric;
  _target_ratio numeric;
  _target_available integer;
  _grace_seconds constant numeric := 5;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _ship FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _me FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _ship.stealing_target_user_id IS NULL THEN RAISE EXCEPTION 'no active steal mission'; END IF;
  IF NOT _force AND (_ship.stealing_ends_at IS NULL OR _ship.stealing_ends_at > now()) THEN RAISE EXCEPTION 'mission not finished'; END IF;

  _target_ship_id := _ship.stealing_target_ship_id;
  _target_user_id := _ship.stealing_target_user_id;

  SELECT * INTO _target_ship FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _target_user_id FOR UPDATE;

  _start := COALESCE(_ship.stealing_started_at, _ship.fishing_started_at);
  IF _force AND _start IS NOT NULL AND _ship.stealing_ends_at IS NOT NULL AND _ship.stealing_ends_at > now() THEN
    _duration := GREATEST(1, EXTRACT(EPOCH FROM (_ship.stealing_ends_at - _start)));
    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (LEAST(now(), _ship.stealing_ends_at) - _start))) + _grace_seconds;
    _ratio := LEAST(1, GREATEST(0, _elapsed / _duration));
  ELSE
    _ratio := 1;
  END IF;

  IF _ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = _ship.catalog_code AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = ('ship-lvl-' || COALESCE(_ship.template_id, 1)) AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE sort_order = COALESCE(_ship.template_id, 1) AND active = true ORDER BY market_level_required ASC LIMIT 1;
  END IF;

  _max := GREATEST(1, COALESCE(_cat.fishing_power, _cat.storage, 10));

  SELECT COALESCE(SUM(GREATEST(0, quantity)), 0)::int INTO _existing
  FROM public.fish_stock WHERE user_id = _me AND ship_id = _attacker_ship_id;
  _remaining_cap := GREATEST(0, GREATEST(1, COALESCE(_cat.storage, _max)) - _existing);
  _market_remaining := public.user_market_remaining(_me);
  _scaled := FLOOR(_max * _ratio)::int;
  IF _ratio > 0 AND _scaled < 1 THEN _scaled := 1; END IF;
  _scaled := LEAST(GREATEST(0, _scaled), _remaining_cap);
  _scaled := LEAST(_scaled::bigint, _market_remaining)::int;

  IF _scaled > 0 THEN
    _remaining := _scaled;

    SELECT sc.fish_pool INTO _pool
    FROM public.ships_owned so JOIN public.ship_catalog sc ON sc.code = COALESCE(so.catalog_code, 'ship-lvl-' || COALESCE(so.template_id, 1))
    WHERE so.id = _target_ship_id AND so.user_id = _target_user_id LIMIT 1;
    IF _pool IS NULL THEN _pool := '[]'::jsonb; END IF;

    FOR _row IN
      WITH pool_ids AS (SELECT jsonb_array_elements_text(_pool) AS fid)
      SELECT fs.id, fs.fish_id, fs.base_value, GREATEST(0, COALESCE(fs.quantity, 1))::int AS quantity
      FROM public.fish_stock fs
      WHERE fs.user_id = _target_user_id AND fs.fish_id IN (SELECT fid FROM pool_ids) AND GREATEST(0, COALESCE(fs.quantity, 1)) > 0
      ORDER BY fs.base_value DESC, fs.caught_at ASC FOR UPDATE SKIP LOCKED
    LOOP
      EXIT WHEN _remaining <= 0;
      _take := LEAST(_remaining, _row.quantity);
      IF _take <= 0 THEN CONTINUE; END IF;
      IF _take >= _row.quantity THEN DELETE FROM public.fish_stock WHERE id = _row.id; ELSE UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _row.id; END IF;
      INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity) VALUES (_me, _row.fish_id, _attacker_ship_id, now(), _row.base_value, _take);
      INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught, updated_at) VALUES (_me, _row.fish_id, _take, _take, now())
      ON CONFLICT (user_id, fish_id) DO UPDATE SET quantity = public.fish_caught.quantity + EXCLUDED.quantity, total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught, updated_at = now();
      INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty) VALUES (_me, _row.fish_id, now(), _take);
      _moved := _moved + _take;
      _value := _value + (_take::bigint * COALESCE(_row.base_value, 0));
      _summary := _summary || jsonb_build_array(jsonb_build_object('fish_id', _row.fish_id, 'value', _row.base_value, 'qty', _take));
      _remaining := _remaining - _take;
    END LOOP;

    IF _remaining > 0 AND _target_ship.id IS NOT NULL AND _target_ship.fishing_started_at IS NOT NULL THEN
      IF _target_ship.catalog_code IS NOT NULL THEN
        SELECT * INTO _target_cat FROM public.ship_catalog WHERE code = _target_ship.catalog_code AND active = true LIMIT 1;
      END IF;
      IF _target_cat.id IS NULL THEN
        SELECT * INTO _target_cat FROM public.ship_catalog WHERE code = ('ship-lvl-' || COALESCE(_target_ship.template_id, 1)) AND active = true LIMIT 1;
      END IF;
      IF _target_cat.id IS NULL THEN
        SELECT * INTO _target_cat FROM public.ship_catalog WHERE sort_order = COALESCE(_target_ship.template_id, 1) AND active = true ORDER BY market_level_required ASC LIMIT 1;
      END IF;

      _target_pool := COALESCE(_target_cat.fish_pool, '[]'::jsonb);
      _pool_len := jsonb_array_length(_target_pool);
      IF _pool_len > 0 THEN
        IF _target_ship.preferred_fish_id IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_target_pool) v(fid) WHERE v.fid = _target_ship.preferred_fish_id) THEN
          _generated_fish_id := _target_ship.preferred_fish_id;
        ELSE
          SELECT p.value INTO _generated_fish_id
          FROM jsonb_array_elements_text(_target_pool) WITH ORDINALITY AS p(value, ord)
          WHERE p.ord = (1 + (abs(hashtextextended(_target_ship_id::text || ':' || _target_ship.fishing_started_at::text, 91003)) % _pool_len))
          LIMIT 1;
        END IF;

        _target_duration := GREATEST(1, COALESCE(_target_cat.fishing_seconds, 30));
        _target_capacity := GREATEST(1, CASE
          WHEN COALESCE(_target_ship.catalog_code, '') IN ('submarine', 'upgrade-sub') OR COALESCE(_target_ship.template_id, 0) IN (32, 33)
            THEN COALESCE(_target_ship.max_hp, _target_cat.storage, 10)
          ELSE COALESCE(_target_cat.storage, 10)
        END);
        _target_elapsed := public._effective_fishing_elapsed(_target_user_id, _target_ship_id, _target_ship.fishing_started_at, now()) + _grace_seconds;
        _target_ratio := LEAST(1, GREATEST(0, _target_elapsed / _target_duration));
        _target_available := ROUND(_target_capacity * _target_ratio)::integer;
        IF _target_ratio > 0 AND _target_available < 1 THEN _target_available := 1; END IF;
        _target_available := LEAST(_target_available, _target_capacity);

        _take := LEAST(_remaining, GREATEST(0, _target_available));
        IF _take > 0 THEN
          SELECT COALESCE(current_price, 0)::bigint INTO _unit_value FROM public.fish_market_prices WHERE fish_market_prices.fish_id = _generated_fish_id;
          INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity) VALUES (_me, _generated_fish_id, _attacker_ship_id, now(), COALESCE(_unit_value, 0), _take);
          INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught, updated_at) VALUES (_me, _generated_fish_id, _take, _take, now())
          ON CONFLICT (user_id, fish_id) DO UPDATE SET quantity = public.fish_caught.quantity + EXCLUDED.quantity, total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught, updated_at = now();
          INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty) VALUES (_me, _generated_fish_id, now(), _take);
          _moved := _moved + _take;
          _value := _value + (_take::bigint * COALESCE(_unit_value, 0));
          _summary := _summary || jsonb_build_array(jsonb_build_object('fish_id', _generated_fish_id, 'value', COALESCE(_unit_value, 0), 'qty', _take));
          _remaining := _remaining - _take;
        END IF;
      END IF;
    END IF;

    IF _remaining > 0 THEN
      FOR _row IN
        SELECT fs.id, fs.fish_id, fs.base_value, GREATEST(0, COALESCE(fs.quantity, 1))::int AS quantity
        FROM public.fish_stock fs
        WHERE fs.user_id = _target_user_id AND GREATEST(0, COALESCE(fs.quantity, 1)) > 0
        ORDER BY fs.base_value DESC, fs.caught_at ASC FOR UPDATE SKIP LOCKED
      LOOP
        EXIT WHEN _remaining <= 0;
        _take := LEAST(_remaining, _row.quantity);
        IF _take <= 0 THEN CONTINUE; END IF;
        IF _take >= _row.quantity THEN DELETE FROM public.fish_stock WHERE id = _row.id; ELSE UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _row.id; END IF;
        INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity) VALUES (_me, _row.fish_id, _attacker_ship_id, now(), _row.base_value, _take);
        INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught, updated_at) VALUES (_me, _row.fish_id, _take, _take, now())
        ON CONFLICT (user_id, fish_id) DO UPDATE SET quantity = public.fish_caught.quantity + EXCLUDED.quantity, total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught, updated_at = now();
        INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty) VALUES (_me, _row.fish_id, now(), _take);
        _moved := _moved + _take;
        _value := _value + (_take::bigint * COALESCE(_row.base_value, 0));
        _summary := _summary || jsonb_build_array(jsonb_build_object('fish_id', _row.fish_id, 'value', _row.base_value, 'qty', _take));
        _remaining := _remaining - _take;
      END LOOP;
    END IF;
  END IF;

  UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL, stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL, stealing_started_at = NULL WHERE id = _attacker_ship_id;
  UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL WHERE id = _target_ship_id AND user_id = _target_user_id;

  IF _moved > 0 THEN
    SELECT display_name, avatar_emoji INTO _thief_name, _thief_emoji
    FROM public.profiles WHERE id = _me;
    IF _thief_name IS NULL THEN _thief_name := 'قرصان'; END IF;
    IF _thief_emoji IS NULL THEN _thief_emoji := '🏴‍☠️'; END IF;

    INSERT INTO public.notifications (recipient_id, title, body, kind, created_by, meta)
    VALUES (
      _target_user_id,
      '🏴‍☠️ تمت سرقتك!',
      _thief_emoji || ' ' || _thief_name || ' سرق منك ' || _moved || ' سمكة بقيمة ' || _value,
      'attack',
      _me,
      jsonb_build_object('ship_id', _target_ship_id, 'attacker_ship_id', _attacker_ship_id, 'stolen_count', _moved, 'total_value', _value, 'event', 'steal_completed')
    );
  END IF;

  RETURN QUERY SELECT _moved, _value, COALESCE(_summary, '[]'::jsonb);
END;
$function$;