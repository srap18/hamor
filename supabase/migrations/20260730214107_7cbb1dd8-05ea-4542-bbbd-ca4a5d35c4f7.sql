CREATE OR REPLACE FUNCTION public.buy_market_freeze(_hours integer)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _cost int;
  _now timestamptz := now();
  _cur_started timestamptz;
  _cur_until timestamptz;
  _cur_offset bigint;
  _cur_frozen jsonb;
  _new_until timestamptz;
  _new_started timestamptz;
  _new_offset bigint;
  _snapshot jsonb;
  _cap timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  _cost := CASE _hours WHEN 2 THEN 50 WHEN 9 THEN 100 WHEN 24 THEN 150 ELSE NULL END;
  IF _cost IS NULL THEN RAISE EXCEPTION 'مدة غير صحيحة'; END IF;

  -- Hard ceiling: a player can never hold more than 24 hours of freeze at once.
  _cap := _now + interval '24 hours';

  SELECT ums.freeze_started_at, ums.freeze_until, COALESCE(ums.rot_freeze_offset_seconds, 0), COALESCE(ums.frozen_prices, '{}'::jsonb)
    INTO _cur_started, _cur_until, _cur_offset, _cur_frozen
    FROM public.user_market_state ums
   WHERE ums.user_id = _uid
   FOR UPDATE;

  IF _cur_until IS NOT NULL AND _cur_until >= _cap THEN
    RAISE EXCEPTION 'التجميد لديك ممتلئ (الحد الأقصى 24 ساعة) — استخدمه قبل الشراء مرة أخرى';
  END IF;

  UPDATE public.profiles
     SET gems = gems - _cost
   WHERE id = _uid AND gems >= _cost;
  IF NOT FOUND THEN RAISE EXCEPTION 'جواهر غير كافية'; END IF;

  IF _cur_until IS NOT NULL AND _cur_until > _now AND _cur_started IS NOT NULL THEN
    _new_started := _cur_started;
    _new_until   := LEAST(_cur_until + (_hours || ' hours')::interval, _cap);
    _new_offset  := COALESCE(_cur_offset, 0);
    _snapshot    := COALESCE(_cur_frozen, '{}'::jsonb); -- keep existing floor
  ELSE
    _new_offset := COALESCE(_cur_offset, 0);
    IF _cur_started IS NOT NULL AND _cur_until IS NOT NULL AND _cur_until > _cur_started THEN
      _new_offset := _new_offset + GREATEST(0, EXTRACT(EPOCH FROM (_cur_until - _cur_started))::bigint);
    END IF;
    _new_started := _now;
    _new_until   := LEAST(_now + (_hours || ' hours')::interval, _cap);
    SELECT COALESCE(jsonb_object_agg(fmp.fish_id,
      GREATEST(
        COALESCE(fps.min_price, fmp.min_price, 0.0001)::numeric,
        LEAST(
          COALESCE(fps.max_price, fmp.max_price, 999999999)::numeric,
          COALESCE(NULLIF(fmp.current_price, 0), 1)::numeric
        )
      )
    ), '{}'::jsonb)
      INTO _snapshot
      FROM public.fish_market_prices fmp
      LEFT JOIN public.fish_price_settings fps ON fps.fish_id = fmp.fish_id;
  END IF;

  INSERT INTO public.user_market_state(user_id, freeze_started_at, freeze_until, rot_freeze_offset_seconds, frozen_prices, updated_at)
  VALUES (_uid, _new_started, _new_until, _new_offset, _snapshot, _now)
  ON CONFLICT (user_id) DO UPDATE
    SET freeze_started_at = EXCLUDED.freeze_started_at,
        freeze_until = EXCLUDED.freeze_until,
        rot_freeze_offset_seconds = EXCLUDED.rot_freeze_offset_seconds,
        frozen_prices = EXCLUDED.frozen_prices,
        updated_at = _now;

  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
  VALUES (_uid, 'market_rot_freeze', -_cost, 'gems',
          jsonb_build_object('hours', _hours, 'extended', (_cur_until IS NOT NULL AND _cur_until > _now), 'capped', true));

  RETURN _new_until;
END;
$function$;