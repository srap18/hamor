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
  _target_ship_id uuid;
  _target_user_id uuid;
  _remaining integer;
  _take integer;
  _row record;
  _summary jsonb := '[]'::jsonb;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _ship
  FROM public.ships_owned
  WHERE id = _attacker_ship_id AND user_id = _me
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _ship.stealing_target_user_id IS NULL THEN RAISE EXCEPTION 'no active steal mission'; END IF;
  IF NOT _force AND (_ship.stealing_ends_at IS NULL OR _ship.stealing_ends_at > now()) THEN
    RAISE EXCEPTION 'mission not finished';
  END IF;

  _target_ship_id := _ship.stealing_target_ship_id;
  _target_user_id := _ship.stealing_target_user_id;

  IF _force AND _ship.fishing_started_at IS NOT NULL AND _ship.stealing_ends_at IS NOT NULL AND _ship.stealing_ends_at > now() THEN
    _duration := GREATEST(1, EXTRACT(EPOCH FROM (_ship.stealing_ends_at - _ship.fishing_started_at)));
    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (LEAST(now(), _ship.stealing_ends_at) - _ship.fishing_started_at)));
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

  _max := GREATEST(1, CASE WHEN COALESCE(_ship.template_id, 0) = 32
                           THEN COALESCE(_ship.max_hp, _cat.storage, _cat.fishing_power, 10)
                           ELSE COALESCE(_cat.storage, _cat.fishing_power, 10) END);

  SELECT COALESCE(SUM(GREATEST(0, quantity)), 0)::int
    INTO _existing
  FROM public.fish_stock
  WHERE user_id = _me AND ship_id = _attacker_ship_id;

  _remaining_cap := GREATEST(0, _max - _existing);
  _market_remaining := public.user_market_remaining(_me);
  _scaled := LEAST(GREATEST(0, FLOOR(_max * _ratio)::int), _remaining_cap);
  _scaled := LEAST(_scaled::bigint, _market_remaining)::int;

  IF _scaled > 0 THEN
    _remaining := _scaled;

    SELECT sc.fish_pool INTO _pool
    FROM public.ships_owned so
    JOIN public.ship_catalog sc ON sc.code = COALESCE(so.catalog_code, 'ship-lvl-' || COALESCE(so.template_id, 1))
    WHERE so.id = _target_ship_id AND so.user_id = _target_user_id
    LIMIT 1;
    IF _pool IS NULL THEN _pool := '[]'::jsonb; END IF;

    FOR _row IN
      WITH pool_ids AS (SELECT jsonb_array_elements_text(_pool) AS fid)
      SELECT fs.id, fs.fish_id, fs.base_value, GREATEST(0, COALESCE(fs.quantity, 1))::int AS quantity
      FROM public.fish_stock fs
      WHERE fs.user_id = _target_user_id
        AND fs.fish_id IN (SELECT fid FROM pool_ids)
        AND GREATEST(0, COALESCE(fs.quantity, 1)) > 0
      ORDER BY fs.base_value DESC, fs.caught_at ASC
      FOR UPDATE SKIP LOCKED
    LOOP
      EXIT WHEN _remaining <= 0;
      _take := LEAST(_remaining, _row.quantity);
      IF _take <= 0 THEN CONTINUE; END IF;

      IF _take >= _row.quantity THEN
        DELETE FROM public.fish_stock WHERE id = _row.id;
      ELSE
        UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _row.id;
      END IF;

      INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
      VALUES (_me, _row.fish_id, _attacker_ship_id, now(), _row.base_value, _take);

      INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
      VALUES (_me, _row.fish_id, _take, _take)
      ON CONFLICT (user_id, fish_id) DO UPDATE
      SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
          total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
          caught_at = now();

      INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
      VALUES (_me, _row.fish_id, now(), _take);

      _moved := _moved + _take;
      _value := _value + (_take::bigint * COALESCE(_row.base_value, 0));
      _summary := _summary || jsonb_build_array(jsonb_build_object('fish_id', _row.fish_id, 'value', _row.base_value, 'qty', _take));
      _remaining := _remaining - _take;
    END LOOP;

    IF _remaining > 0 THEN
      FOR _row IN
        SELECT fs.id, fs.fish_id, fs.base_value, GREATEST(0, COALESCE(fs.quantity, 1))::int AS quantity
        FROM public.fish_stock fs
        WHERE fs.user_id = _target_user_id
          AND GREATEST(0, COALESCE(fs.quantity, 1)) > 0
        ORDER BY fs.base_value DESC, fs.caught_at ASC
        FOR UPDATE SKIP LOCKED
      LOOP
        EXIT WHEN _remaining <= 0;
        _take := LEAST(_remaining, _row.quantity);
        IF _take <= 0 THEN CONTINUE; END IF;

        IF _take >= _row.quantity THEN
          DELETE FROM public.fish_stock WHERE id = _row.id;
        ELSE
          UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _row.id;
        END IF;

        INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
        VALUES (_me, _row.fish_id, _attacker_ship_id, now(), _row.base_value, _take);

        INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
        VALUES (_me, _row.fish_id, _take, _take)
        ON CONFLICT (user_id, fish_id) DO UPDATE
        SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
            total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
            caught_at = now();

        INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
        VALUES (_me, _row.fish_id, now(), _take);

        _moved := _moved + _take;
        _value := _value + (_take::bigint * COALESCE(_row.base_value, 0));
        _summary := _summary || jsonb_build_array(jsonb_build_object('fish_id', _row.fish_id, 'value', _row.base_value, 'qty', _take));
        _remaining := _remaining - _take;
      END LOOP;
    END IF;
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_ends_at = NULL
   WHERE id = _attacker_ship_id;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL
   WHERE id = _target_ship_id AND user_id = _target_user_id;

  RETURN QUERY SELECT _moved, _value, COALESCE(_summary, '[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_steal_mission(uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_steal_mission(uuid, boolean) FROM anon, public;

CREATE OR REPLACE FUNCTION public.cancel_steal_mission(_attacker_ship_id uuid)
 RETURNS TABLE(stolen_count integer, total_value bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _ship public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _pool jsonb;
  _max integer;
  _existing integer;
  _remaining_cap integer;
  _market_remaining bigint;
  _scaled integer;
  _moved integer := 0;
  _value bigint := 0;
  _prot timestamptz;
  _ratio numeric := 0;
  _duration numeric;
  _elapsed numeric;
  _target_ship_id uuid;
  _target_user_id uuid;
  _remaining integer;
  _take integer;
  _row record;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _ship FROM public.ships_owned WHERE id = _attacker_ship_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _ship.stealing_target_user_id IS NULL THEN RAISE EXCEPTION 'no active steal mission'; END IF;
  IF _ship.user_id <> _me AND _ship.stealing_target_user_id <> _me THEN RAISE EXCEPTION 'not allowed'; END IF;

  _target_ship_id := _ship.stealing_target_ship_id;
  _target_user_id := _ship.stealing_target_user_id;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_user_id;
  IF _prot IS NOT NULL AND _prot > now() THEN
    UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
     WHERE id = _attacker_ship_id;
    UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL
     WHERE id = _target_ship_id AND user_id = _target_user_id;
    RETURN QUERY SELECT 0, 0::bigint; RETURN;
  END IF;

  IF _ship.fishing_started_at IS NULL OR _ship.stealing_ends_at IS NULL THEN
    _ratio := 0;
  ELSE
    _duration := GREATEST(1, EXTRACT(EPOCH FROM (_ship.stealing_ends_at - _ship.fishing_started_at)));
    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (LEAST(now(), _ship.stealing_ends_at) - _ship.fishing_started_at)));
    _ratio := LEAST(1, GREATEST(0, _elapsed / _duration));
  END IF;

  IF _ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = _ship.catalog_code AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = ('ship-lvl-' || COALESCE(_ship.template_id, 1)) AND active = true LIMIT 1;
  END IF;

  _max := GREATEST(1, CASE WHEN COALESCE(_ship.template_id, 0) = 32
                           THEN COALESCE(_ship.max_hp, _cat.storage, _cat.fishing_power, 10)
                           ELSE COALESCE(_cat.storage, _cat.fishing_power, 10) END);

  IF _ship.user_id = _me THEN
    SELECT COALESCE(SUM(GREATEST(0, quantity)), 0)::int
      INTO _existing
    FROM public.fish_stock
    WHERE user_id = _me AND ship_id = _attacker_ship_id;

    _remaining_cap := GREATEST(0, _max - _existing);
    _market_remaining := public.user_market_remaining(_me);
    _scaled := LEAST(GREATEST(0, FLOOR(_max * _ratio)::int), _remaining_cap);
    _scaled := LEAST(_scaled::bigint, _market_remaining)::int;
  ELSE
    _scaled := 0;
  END IF;

  IF _scaled > 0 THEN
    _remaining := _scaled;

    SELECT sc.fish_pool INTO _pool
    FROM public.ships_owned so
    JOIN public.ship_catalog sc ON sc.code = COALESCE(so.catalog_code, 'ship-lvl-' || COALESCE(so.template_id, 1))
    WHERE so.id = _target_ship_id AND so.user_id = _target_user_id
    LIMIT 1;
    IF _pool IS NULL THEN _pool := '[]'::jsonb; END IF;

    FOR _row IN
      WITH pool_ids AS (SELECT jsonb_array_elements_text(_pool) AS fid)
      SELECT fs.id, fs.fish_id, fs.base_value, GREATEST(0, COALESCE(fs.quantity, 1))::int AS quantity
      FROM public.fish_stock fs
      WHERE fs.user_id = _target_user_id
        AND fs.fish_id IN (SELECT fid FROM pool_ids)
        AND GREATEST(0, COALESCE(fs.quantity, 1)) > 0
      ORDER BY fs.base_value DESC, fs.caught_at ASC
      FOR UPDATE SKIP LOCKED
    LOOP
      EXIT WHEN _remaining <= 0;
      _take := LEAST(_remaining, _row.quantity);
      IF _take <= 0 THEN CONTINUE; END IF;

      IF _take >= _row.quantity THEN
        DELETE FROM public.fish_stock WHERE id = _row.id;
      ELSE
        UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _row.id;
      END IF;

      INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
      VALUES (_ship.user_id, _row.fish_id, _attacker_ship_id, now(), _row.base_value, _take);

      INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
      VALUES (_ship.user_id, _row.fish_id, _take, _take)
      ON CONFLICT (user_id, fish_id) DO UPDATE
      SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
          total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
          caught_at = now();

      INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
      VALUES (_ship.user_id, _row.fish_id, now(), _take);

      _moved := _moved + _take;
      _value := _value + (_take::bigint * COALESCE(_row.base_value, 0));
      _remaining := _remaining - _take;
    END LOOP;

    IF _remaining > 0 THEN
      FOR _row IN
        SELECT fs.id, fs.fish_id, fs.base_value, GREATEST(0, COALESCE(fs.quantity, 1))::int AS quantity
        FROM public.fish_stock fs
        WHERE fs.user_id = _target_user_id
          AND GREATEST(0, COALESCE(fs.quantity, 1)) > 0
        ORDER BY fs.base_value DESC, fs.caught_at ASC
        FOR UPDATE SKIP LOCKED
      LOOP
        EXIT WHEN _remaining <= 0;
        _take := LEAST(_remaining, _row.quantity);
        IF _take <= 0 THEN CONTINUE; END IF;

        IF _take >= _row.quantity THEN
          DELETE FROM public.fish_stock WHERE id = _row.id;
        ELSE
          UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _row.id;
        END IF;

        INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
        VALUES (_ship.user_id, _row.fish_id, _attacker_ship_id, now(), _row.base_value, _take);

        INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
        VALUES (_ship.user_id, _row.fish_id, _take, _take)
        ON CONFLICT (user_id, fish_id) DO UPDATE
        SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
            total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
            caught_at = now();

        INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
        VALUES (_ship.user_id, _row.fish_id, now(), _take);

        _moved := _moved + _take;
        _value := _value + (_take::bigint * COALESCE(_row.base_value, 0));
        _remaining := _remaining - _take;
      END LOOP;
    END IF;
  END IF;

  UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
   WHERE id = _attacker_ship_id;
  UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL
   WHERE id = _target_ship_id AND user_id = _target_user_id;

  RETURN QUERY SELECT _moved, _value;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cancel_steal_mission(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.cancel_steal_mission(uuid) FROM anon, public;

CREATE OR REPLACE FUNCTION public.test_steal_claim_moves_one_fish()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := gen_random_uuid();
  _defender uuid := gen_random_uuid();
  _attacker_ship uuid := gen_random_uuid();
  _defender_ship uuid := gen_random_uuid();
  _before_attacker bigint;
  _before_defender bigint;
  _after_attacker bigint;
  _after_defender bigint;
  _row record;
BEGIN
  INSERT INTO public.profiles(id, display_name, avatar_emoji) VALUES
    (_attacker, 'steal-test-attacker', '🏴‍☠️'),
    (_defender, 'steal-test-defender', '🐟');
  INSERT INTO public.user_fish_market(user_id, level) VALUES (_attacker, 30), (_defender, 30)
  ON CONFLICT (user_id) DO UPDATE SET level = EXCLUDED.level;
  INSERT INTO public.ships_owned(id, user_id, template_id, catalog_code, at_sea, fishing_started_at, stealing_target_user_id, stealing_target_ship_id, stealing_ends_at)
  VALUES
    (_attacker_ship, _attacker, 1, 'ship-lvl-1', true, now() - interval '1 minute', _defender, _defender_ship, now() - interval '1 second'),
    (_defender_ship, _defender, 1, 'ship-lvl-1', true, now() - interval '5 minutes', NULL, NULL, NULL);
  INSERT INTO public.fish_stock(user_id, fish_id, ship_id, base_value, quantity)
  VALUES (_defender, 'sardine', _defender_ship, 1, 1);

  SELECT COALESCE(SUM(quantity),0) INTO _before_attacker FROM public.fish_stock WHERE user_id = _attacker;
  SELECT COALESCE(SUM(quantity),0) INTO _before_defender FROM public.fish_stock WHERE user_id = _defender;

  SELECT * INTO _row FROM public.claim_steal_mission(_attacker_ship, false);

  SELECT COALESCE(SUM(quantity),0) INTO _after_attacker FROM public.fish_stock WHERE user_id = _attacker;
  SELECT COALESCE(SUM(quantity),0) INTO _after_defender FROM public.fish_stock WHERE user_id = _defender;

  IF COALESCE(_row.stolen_count, 0) <> 1 OR _after_attacker <> _before_attacker + 1 OR _after_defender <> _before_defender - 1 THEN
    RAISE EXCEPTION 'claim steal one fish test failed: stolen %, attacker %->%, defender %->%', COALESCE(_row.stolen_count, 0), _before_attacker, _after_attacker, _before_defender, _after_defender;
  END IF;

  DELETE FROM public.competition_catches WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.fish_stock WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.fish_caught WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.ships_owned WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.user_fish_market WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.profiles WHERE id IN (_attacker, _defender);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  DELETE FROM public.competition_catches WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.fish_stock WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.fish_caught WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.ships_owned WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.user_fish_market WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.profiles WHERE id IN (_attacker, _defender);
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.test_steal_cancel_moves_one_fish()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := gen_random_uuid();
  _defender uuid := gen_random_uuid();
  _attacker_ship uuid := gen_random_uuid();
  _defender_ship uuid := gen_random_uuid();
  _before_attacker bigint;
  _before_defender bigint;
  _after_attacker bigint;
  _after_defender bigint;
  _row record;
BEGIN
  INSERT INTO public.profiles(id, display_name, avatar_emoji) VALUES
    (_attacker, 'steal-cancel-test-attacker', '🏴‍☠️'),
    (_defender, 'steal-cancel-test-defender', '🐟');
  INSERT INTO public.user_fish_market(user_id, level) VALUES (_attacker, 30), (_defender, 30)
  ON CONFLICT (user_id) DO UPDATE SET level = EXCLUDED.level;
  INSERT INTO public.ships_owned(id, user_id, template_id, catalog_code, at_sea, fishing_started_at, stealing_target_user_id, stealing_target_ship_id, stealing_ends_at)
  VALUES
    (_attacker_ship, _attacker, 1, 'ship-lvl-1', true, now() - interval '60 seconds', _defender, _defender_ship, now() + interval '60 seconds'),
    (_defender_ship, _defender, 1, 'ship-lvl-1', true, now() - interval '5 minutes', NULL, NULL, NULL);
  INSERT INTO public.fish_stock(user_id, fish_id, ship_id, base_value, quantity)
  VALUES (_defender, 'sardine', _defender_ship, 1, 1);

  SELECT COALESCE(SUM(quantity),0) INTO _before_attacker FROM public.fish_stock WHERE user_id = _attacker;
  SELECT COALESCE(SUM(quantity),0) INTO _before_defender FROM public.fish_stock WHERE user_id = _defender;

  SELECT * INTO _row FROM public.cancel_steal_mission(_attacker_ship);

  SELECT COALESCE(SUM(quantity),0) INTO _after_attacker FROM public.fish_stock WHERE user_id = _attacker;
  SELECT COALESCE(SUM(quantity),0) INTO _after_defender FROM public.fish_stock WHERE user_id = _defender;

  IF COALESCE(_row.stolen_count, 0) <> 1 OR _after_attacker <> _before_attacker + 1 OR _after_defender <> _before_defender - 1 THEN
    RAISE EXCEPTION 'cancel steal one fish test failed: stolen %, attacker %->%, defender %->%', COALESCE(_row.stolen_count, 0), _before_attacker, _after_attacker, _before_defender, _after_defender;
  END IF;

  DELETE FROM public.competition_catches WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.fish_stock WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.fish_caught WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.ships_owned WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.user_fish_market WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.profiles WHERE id IN (_attacker, _defender);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  DELETE FROM public.competition_catches WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.fish_stock WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.fish_caught WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.ships_owned WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.user_fish_market WHERE user_id IN (_attacker, _defender);
  DELETE FROM public.profiles WHERE id IN (_attacker, _defender);
  RAISE;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.test_steal_claim_moves_one_fish() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.test_steal_cancel_moves_one_fish() FROM anon, public;