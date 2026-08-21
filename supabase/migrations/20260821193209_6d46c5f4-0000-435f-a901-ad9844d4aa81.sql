CREATE OR REPLACE FUNCTION public.sell_fish_caught(_fish_id text, _qty integer, _unit_price numeric DEFAULT NULL::numeric)
 RETURNS TABLE(remaining integer, coins_earned bigint, new_coins bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _have integer; _sell integer; _earned bigint; _new_coins bigint; _remaining integer;
  _market_price numeric; _caught_at timestamptz;
  _now timestamptz := now();
  _frozen_prices jsonb; _freeze_until timestamptz; _frozen_unit numeric;
  _hours numeric; _rot numeric;
  _final_unit numeric; _max_override numeric;
  _min_bound numeric; _max_bound numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty <= 0 THEN RAISE EXCEPTION 'invalid qty'; END IF;

  SELECT quantity, updated_at INTO _have, _caught_at
  FROM public.fish_caught WHERE user_id = _uid AND fish_id = _fish_id FOR UPDATE;
  IF _have IS NULL OR _have <= 0 THEN RAISE EXCEPTION 'no fish to sell'; END IF;

  SELECT current_price INTO _market_price FROM public.fish_market_prices WHERE fish_id = _fish_id;
  IF _market_price IS NULL OR _market_price <= 0 THEN
    _market_price := GREATEST(0.1, COALESCE(_unit_price, 0.1));
  END IF;

  SELECT min_p, max_p INTO _min_bound, _max_bound FROM public._fish_price_bounds(_fish_id);

  -- Freeze-aware rot: pause the rot clock during every paid freeze window.
  _hours := GREATEST(0, (EXTRACT(EPOCH FROM (_now - _caught_at))
              - public._rot_frozen_seconds(_uid, _caught_at, _now)) / 3600.0);
  _rot := GREATEST(0.5, 1 - (0.01 * _hours));

  _max_override := public._market_expert_max_price(_uid, _fish_id);
  IF _max_override IS NOT NULL THEN
    _final_unit := _max_override;
    _rot := 1::numeric;
  ELSE
    _final_unit := round((_market_price * _rot)::numeric, 2);
  END IF;

  -- Frozen price snapshot acts as a floor while the freeze is active.
  SELECT ums.freeze_until, COALESCE(ums.frozen_prices, '{}'::jsonb)
    INTO _freeze_until, _frozen_prices
    FROM public.user_market_state ums WHERE ums.user_id = _uid;
  IF _freeze_until IS NOT NULL AND _freeze_until > _now
     AND _frozen_prices ? _fish_id THEN
    _frozen_unit := (_frozen_prices ->> _fish_id)::numeric;
    _final_unit := GREATEST(_final_unit, _frozen_unit);
  END IF;

  -- Strict admin bounds
  _final_unit := GREATEST(_min_bound, LEAST(_max_bound, _final_unit));

  _sell := LEAST(_qty, _have);
  _remaining := _have - _sell;
  _earned := (_sell::numeric * _final_unit)::bigint;

  IF _remaining > 0 THEN
    UPDATE public.fish_caught SET quantity = _remaining WHERE user_id = _uid AND fish_id = _fish_id;
  ELSE
    DELETE FROM public.fish_caught WHERE user_id = _uid AND fish_id = _fish_id;
  END IF;

  UPDATE public.profiles SET coins = coins + _earned WHERE id = _uid RETURNING coins INTO _new_coins;

  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
  VALUES (_uid, 'fish_sale', _earned, 'coins', jsonb_build_object(
    'fish_id', _fish_id, 'qty', _sell, 'unit_price', _final_unit,
    'quality_pct', round((_rot * 100)::numeric, 2),
    'server_priced', true, 'market_expert', _max_override IS NOT NULL,
    'bounds_min', _min_bound, 'bounds_max', _max_bound
  ));

  PERFORM public._record_fish_sale_gold(_uid, _earned);
  remaining := _remaining; coins_earned := _earned; new_coins := _new_coins;
  RETURN NEXT;
END;
$function$;