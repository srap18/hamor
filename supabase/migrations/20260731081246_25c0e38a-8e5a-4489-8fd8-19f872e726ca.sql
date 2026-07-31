CREATE OR REPLACE FUNCTION public.steal_mission_preview(_attacker_ship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _my public.ships_owned%ROWTYPE;
  _tgt public.ships_owned%ROWTYPE;
  _dur numeric; _ratio numeric := 0;
  _free bigint; _avail bigint; _market bigint; _allowed bigint; _a bigint;
  _reason text := NULL;
BEGIN
  IF _me IS NULL THEN RETURN jsonb_build_object('ok', false, 'count', 0, 'reason', 'not authenticated'); END IF;

  SELECT * INTO _my FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _me;
  IF _my.id IS NULL OR _my.stealing_target_ship_id IS NULL OR _my.stealing_ends_at IS NULL OR _my.stealing_started_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'count', 0, 'reason', 'no active steal mission');
  END IF;

  _dur := GREATEST(1, EXTRACT(EPOCH FROM (_my.stealing_ends_at - _my.stealing_started_at)));
  _ratio := LEAST(1, GREATEST(0, EXTRACT(EPOCH FROM (now() - _my.stealing_started_at)) / _dur));

  SELECT * INTO _tgt FROM public.ships_owned WHERE id = _my.stealing_target_ship_id;
  IF _tgt.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'count', 0, 'ratio', _ratio, 'reason', 'target_gone');
  END IF;

  -- fish_stock is market inventory. ship_id records its source and must not be
  -- treated as cargo still occupying the ship on a later mission.
  _free   := GREATEST(0, public._ship_fish_capacity(_attacker_ship_id));
  _avail  := public._ship_fish_load(_tgt.user_id, _tgt.id);
  _market := public.user_market_remaining(_me);

  _a := LEAST(_free, _avail);
  _allowed := FLOOR(_a * _ratio)::bigint;
  _allowed := LEAST(_allowed, _free, _avail, _market);
  IF _allowed < 0 THEN _allowed := 0; END IF;

  IF _allowed <= 0 THEN
    IF _avail <= 0 THEN _reason := 'target_empty';
    ELSIF _free <= 0 THEN _reason := 'hold_full';
    ELSIF _market <= 0 THEN _reason := 'market_full';
    ELSE _reason := 'too_early';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'count', _allowed,
    'ratio', _ratio,
    'free', _free,
    'avail', _avail,
    'market', _market,
    'reason', _reason
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._settle_steal_mission(_attacker_ship_id uuid, _reason text)
RETURNS TABLE(stolen_count integer, total_value bigint, fish_summary jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _my public.ships_owned%ROWTYPE;
  _tgt public.ships_owned%ROWTYPE;
  _ratio numeric := 0;
  _dur numeric;
  _free bigint;
  _avail bigint;
  _market bigint;
  _allowed bigint;
  _remaining bigint;
  _moved bigint := 0;
  _value bigint := 0;
  _summary jsonb := '[]'::jsonb;
  r RECORD;
  _take bigint;
  _a bigint;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('steal_mission:' || _attacker_ship_id::text, 0));

  SELECT * INTO _my FROM public.ships_owned
   WHERE id = _attacker_ship_id AND user_id = _me FOR UPDATE;
  IF _my.id IS NULL THEN RAISE EXCEPTION 'no active steal mission'; END IF;
  IF _my.stealing_target_ship_id IS NULL OR _my.stealing_ends_at IS NULL OR _my.stealing_started_at IS NULL THEN
    RAISE EXCEPTION 'no active steal mission';
  END IF;

  _dur := GREATEST(1, EXTRACT(EPOCH FROM (_my.stealing_ends_at - _my.stealing_started_at)));
  _ratio := LEAST(1, GREATEST(0, EXTRACT(EPOCH FROM (now() - _my.stealing_started_at)) / _dur));

  IF _reason = 'claim' AND _ratio < 1 THEN
    RAISE EXCEPTION 'mission not finished';
  END IF;

  SELECT * INTO _tgt FROM public.ships_owned
   WHERE id = _my.stealing_target_ship_id FOR UPDATE;

  UPDATE public.ships_owned
     SET stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_started_at = NULL,
         stealing_ends_at = NULL,
         at_sea = false
   WHERE id = _attacker_ship_id;

  IF _tgt.id IS NULL THEN
    RETURN QUERY SELECT 0, 0::bigint, '[]'::jsonb; RETURN;
  END IF;

  -- Existing market stock tagged with this ship is historical source data,
  -- not cargo that remains aboard the ship between missions.
  _free   := GREATEST(0, public._ship_fish_capacity(_attacker_ship_id));
  _avail  := public._ship_fish_load(_tgt.user_id, _tgt.id);
  _market := public.user_market_remaining(_me);

  _a := LEAST(_free, _avail);
  _allowed := FLOOR(_a * _ratio)::bigint;
  _allowed := LEAST(_allowed, _free, _avail, _market);
  IF _allowed <= 0 THEN
    RETURN QUERY SELECT 0, 0::bigint, '[]'::jsonb; RETURN;
  END IF;

  _remaining := _allowed;

  FOR r IN
    SELECT id, fish_id, base_value, quantity
      FROM public.fish_stock
     WHERE user_id = _tgt.user_id AND ship_id = _tgt.id AND quantity > 0
     ORDER BY base_value DESC, caught_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN _remaining <= 0;
    _take := LEAST(_remaining, r.quantity);
    IF _take <= 0 THEN CONTINUE; END IF;

    IF _take >= r.quantity THEN
      UPDATE public.fish_stock
         SET user_id = _me, ship_id = _attacker_ship_id, caught_at = now()
       WHERE id = r.id;
    ELSE
      UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = r.id;
      INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
      VALUES (_me, r.fish_id, _attacker_ship_id, now(), r.base_value, _take);
    END IF;

    _moved := _moved + _take;
    _value := _value + (_take * COALESCE(r.base_value, 0));
    _remaining := _remaining - _take;
    _summary := _summary || jsonb_build_array(
      jsonb_build_object('fish_id', r.fish_id, 'qty', _take, 'value', _take * COALESCE(r.base_value,0))
    );
  END LOOP;

  RETURN QUERY SELECT _moved::int, _value, _summary;
END;
$function$;