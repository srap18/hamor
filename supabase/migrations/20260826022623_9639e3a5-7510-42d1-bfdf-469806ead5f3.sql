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
  _cur_frozen jsonb;
  _cur_windows jsonb;
  _new_windows jsonb;
  _new_until timestamptz;
  _new_started timestamptz;
  _snapshot jsonb;
  _cap timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  _cost := CASE _hours WHEN 2 THEN 50 WHEN 9 THEN 100 WHEN 24 THEN 150 ELSE NULL END;
  IF _cost IS NULL THEN RAISE EXCEPTION 'مدة غير صحيحة'; END IF;

  _cap := _now + interval '72 hours';

  SELECT ums.freeze_started_at, ums.freeze_until, COALESCE(ums.frozen_prices, '{}'::jsonb),
         COALESCE(ums.freeze_windows, '[]'::jsonb)
    INTO _cur_started, _cur_until, _cur_frozen, _cur_windows
    FROM public.user_market_state ums
   WHERE ums.user_id = _uid
   FOR UPDATE;

  _cur_windows := COALESCE(_cur_windows, '[]'::jsonb);
  _new_windows := _cur_windows;

  IF _cur_until IS NOT NULL AND _cur_until > _now THEN
    IF _cur_until + (_hours || ' hours')::interval > _cap THEN
      RAISE EXCEPTION 'لا يمكن التمديد: الحد الأقصى 72 ساعة تجميد. المتبقي لديك % ساعة — استخدمه أولاً.',
        round(EXTRACT(epoch FROM (_cur_until - _now))/3600.0, 1);
    END IF;
    _new_started := GREATEST(COALESCE(_cur_started, _now), _now - interval '72 hours');
    _new_until   := _cur_until + (_hours || ' hours')::interval;
    _snapshot    := COALESCE(_cur_frozen, '{}'::jsonb);
  ELSE
    IF _cur_started IS NOT NULL AND _cur_until IS NOT NULL AND _cur_until > _cur_started THEN
      _new_windows := _cur_windows || jsonb_build_array(
        jsonb_build_object('s', _cur_started, 'e', LEAST(_cur_until, _now))
      );
    END IF;
    _new_started := _now;
    _new_until   := _now + (_hours || ' hours')::interval;
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

  SELECT COALESCE(jsonb_agg(w), '[]'::jsonb) INTO _new_windows
    FROM jsonb_array_elements(_new_windows) w
   WHERE COALESCE(NULLIF(w->>'e','')::timestamptz, _now) > _now - interval '14 days';

  UPDATE public.profiles SET gems = gems - _cost WHERE id = _uid AND gems >= _cost;
  IF NOT FOUND THEN RAISE EXCEPTION 'جواهر غير كافية'; END IF;

  INSERT INTO public.user_market_state(user_id, freeze_started_at, freeze_until, rot_freeze_offset_seconds, frozen_prices, freeze_windows, updated_at)
  VALUES (_uid, _new_started, _new_until, 0, _snapshot, _new_windows, _now)
  ON CONFLICT (user_id) DO UPDATE
    SET freeze_started_at = EXCLUDED.freeze_started_at,
        freeze_until = EXCLUDED.freeze_until,
        rot_freeze_offset_seconds = 0,
        frozen_prices = EXCLUDED.frozen_prices,
        freeze_windows = EXCLUDED.freeze_windows,
        updated_at = _now;

  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
  VALUES (_uid, 'market_rot_freeze', -_cost, 'gems',
          jsonb_build_object('hours', _hours, 'extended', (_cur_until IS NOT NULL AND _cur_until > _now), 'until', _new_until));

  RETURN _new_until;
END;
$function$;