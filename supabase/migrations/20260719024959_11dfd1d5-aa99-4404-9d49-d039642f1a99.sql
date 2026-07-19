CREATE OR REPLACE FUNCTION public.buy_background_gems(_bg_id text, _gems bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _have bigint;
  _server_price bigint;
  _duration_days int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  _server_price := CASE _bg_id
    WHEN 'eiffel_night'     THEN 10000
    WHEN 'crystal_kingdom'  THEN 10000
    WHEN 'eiffel'           THEN 5000
    WHEN 'hilal'            THEN 11000
    WHEN 'worldcup'         THEN 1000000
    ELSE NULL
  END;
  IF _server_price IS NULL THEN RAISE EXCEPTION 'bg_not_purchasable_with_gems'; END IF;

  -- worldcup and hilal are permanent; others are 7-day timed
  _duration_days := CASE WHEN _bg_id IN ('worldcup','hilal') THEN NULL ELSE 7 END;

  _server_price := CEIL(public.get_effective_shop_price(_uid, _server_price::numeric))::bigint;
  SELECT gems INTO _have FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _have IS NULL OR _have < _server_price THEN RAISE EXCEPTION 'not_enough_gems'; END IF;
  UPDATE public.profiles SET gems = gems - _server_price WHERE id = _uid;

  IF EXISTS (SELECT 1 FROM public.inventory WHERE user_id=_uid AND item_type='background' AND item_id=_bg_id) THEN
    IF _duration_days IS NULL THEN
      UPDATE public.inventory
         SET meta = COALESCE(meta,'{}'::jsonb) - 'expires_at',
             acquired_at = now()
       WHERE user_id=_uid AND item_type='background' AND item_id=_bg_id;
    ELSE
      UPDATE public.inventory
         SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('expires_at', (now() + make_interval(days => _duration_days))::text),
             acquired_at = now()
       WHERE user_id=_uid AND item_type='background' AND item_id=_bg_id;
    END IF;
  ELSE
    IF _duration_days IS NULL THEN
      INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
      VALUES (_uid, 'background', _bg_id, 1, '{}'::jsonb);
    ELSE
      INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
      VALUES (_uid, 'background', _bg_id, 1,
              jsonb_build_object('expires_at', (now() + make_interval(days => _duration_days))::text));
    END IF;
  END IF;
  UPDATE public.profiles SET selected_bg_id = _bg_id WHERE id = _uid;
END
$function$;

-- Remove expiration from all existing Hilal background inventory entries
UPDATE public.inventory
   SET meta = COALESCE(meta,'{}'::jsonb) - 'expires_at' - 'purchased_at' - 'duration_days'
 WHERE item_type = 'background' AND item_id = 'hilal';