CREATE OR REPLACE FUNCTION public.buy_background_gems(_bg_id text, _gems bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _have bigint;
  _already boolean;
  _server_price bigint;
  _duration_days int := NULL;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  _server_price := CASE _bg_id
    WHEN 'eiffel_night'     THEN 10000
    WHEN 'crystal_kingdom'  THEN 10000
    WHEN 'eiffel'           THEN 5000
    WHEN 'hilal'            THEN 11000
    ELSE NULL
  END;
  IF _server_price IS NULL THEN RAISE EXCEPTION 'bg_not_purchasable_with_gems'; END IF;

  IF _bg_id = 'hilal' THEN
    _duration_days := 7;
  END IF;

  -- Timed backgrounds: always deduct and (re)set expiry so the user can renew.
  IF _duration_days IS NOT NULL THEN
    _server_price := CEIL(public.get_effective_shop_price(_uid, _server_price::numeric))::bigint;
    SELECT gems INTO _have FROM public.profiles WHERE id = _uid FOR UPDATE;
    IF _have IS NULL OR _have < _server_price THEN RAISE EXCEPTION 'not_enough_gems'; END IF;
    UPDATE public.profiles SET gems = gems - _server_price WHERE id = _uid;

    -- Upsert inventory row with new expires_at (extend from now, do not stack).
    IF EXISTS (SELECT 1 FROM public.inventory WHERE user_id=_uid AND item_type='background' AND item_id=_bg_id) THEN
      UPDATE public.inventory
         SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('expires_at', (now() + make_interval(days => _duration_days))::text),
             acquired_at = now()
       WHERE user_id=_uid AND item_type='background' AND item_id=_bg_id;
    ELSE
      INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
      VALUES (_uid, 'background', _bg_id, 1,
              jsonb_build_object('expires_at', (now() + make_interval(days => _duration_days))::text));
    END IF;
    UPDATE public.profiles SET selected_bg_id = _bg_id WHERE id = _uid;
    RETURN;
  END IF;

  -- Permanent backgrounds (existing behaviour)
  SELECT EXISTS (
    SELECT 1 FROM public.inventory
     WHERE user_id = _uid AND item_type = 'background' AND item_id = _bg_id
  ) INTO _already;
  IF NOT _already THEN
    _server_price := CEIL(public.get_effective_shop_price(_uid, _server_price::numeric))::bigint;
    SELECT gems INTO _have FROM public.profiles WHERE id = _uid FOR UPDATE;
    IF _have IS NULL OR _have < _server_price THEN RAISE EXCEPTION 'not_enough_gems'; END IF;
    UPDATE public.profiles SET gems = gems - _server_price WHERE id = _uid;
    INSERT INTO public.inventory(user_id, item_type, item_id, quantity)
    VALUES (_uid, 'background', _bg_id, 1);
  END IF;
  UPDATE public.profiles SET selected_bg_id = _bg_id WHERE id = _uid;
END
$function$;