CREATE OR REPLACE FUNCTION public.steal_mission_preview(_attacker_ship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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

  _free   := GREATEST(0, public._ship_fish_capacity(_attacker_ship_id) - public._ship_fish_load(_me, _attacker_ship_id));
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

GRANT EXECUTE ON FUNCTION public.steal_mission_preview(uuid) TO authenticated;