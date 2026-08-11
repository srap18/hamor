CREATE OR REPLACE FUNCTION public._settle_steal_mission(_attacker_ship_id uuid, _reason text)
RETURNS TABLE(stolen_count integer, total_value bigint, fish_summary jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _me uuid := auth.uid();
  _my public.ships_owned%ROWTYPE;
  _tgt public.ships_owned%ROWTYPE;
  _ratio numeric := 0;
  _dur numeric;
  _free bigint; _avail bigint; _market bigint; _allowed bigint; _a bigint;
  _pc record;
  _unit bigint := 0;
  _shift numeric;
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
    PERFORM public._steal_log_settle(_me, _attacker_ship_id, 0, 0, NULL, _reason);
    RETURN QUERY SELECT 0, 0::bigint, '[]'::jsonb; RETURN;
  END IF;

  SELECT * INTO _pc FROM public._ship_pending_catch(_tgt.user_id, _tgt.id);

  _free   := GREATEST(0, public._ship_fish_capacity(_attacker_ship_id));
  _avail  := GREATEST(0, COALESCE(_pc.qty, 0));
  _market := public.user_market_remaining(_me);

  _a := LEAST(_free, _avail);
  _allowed := FLOOR(_a * _ratio)::bigint;
  _allowed := LEAST(_allowed, _free, _avail, _market);

  IF _allowed <= 0 OR _pc.fish_id IS NULL THEN
    PERFORM public._steal_log_settle(_me, _attacker_ship_id, 0, 0, _pc.fish_id, _reason);
    RETURN QUERY SELECT 0, 0::bigint, '[]'::jsonb; RETURN;
  END IF;

  SELECT COALESCE(current_price, 0)::bigint INTO _unit
    FROM public.fish_market_prices WHERE fish_market_prices.fish_id = _pc.fish_id LIMIT 1;

  INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
  VALUES (_me, _pc.fish_id, _attacker_ship_id, now(), COALESCE(_unit, 0), _allowed);

  -- Deduct the stolen amount from the target's in-progress catch
  IF COALESCE(_pc.capacity, 0) > 0 AND COALESCE(_pc.duration, 0) > 0 THEN
    _shift := (_allowed::numeric / _pc.capacity::numeric) * _pc.duration::numeric;
    UPDATE public.ships_owned
       SET fishing_started_at = LEAST(now(), fishing_started_at + make_interval(secs => _shift))
     WHERE id = _tgt.id AND fishing_started_at IS NOT NULL;
  END IF;

  PERFORM public._steal_log_settle(_me, _attacker_ship_id, _allowed,
    (_allowed * COALESCE(_unit, 0))::bigint, _pc.fish_id, _reason);

  RETURN QUERY SELECT _allowed::int, (_allowed * COALESCE(_unit,0))::bigint,
    jsonb_build_array(jsonb_build_object('fish_id', _pc.fish_id, 'qty', _allowed, 'value', _allowed * COALESCE(_unit,0)));
END;
$fn$;