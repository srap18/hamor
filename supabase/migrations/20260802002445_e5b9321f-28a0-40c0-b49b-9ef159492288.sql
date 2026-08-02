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
  _is_legacy boolean;
  _has_row boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  _server_price := CASE _bg_id
    WHEN 'eiffel_night'     THEN 7000
    WHEN 'crystal_kingdom'  THEN 7000
    WHEN 'eiffel'           THEN 3500
    WHEN 'hilal'            THEN 5000
    WHEN 'spongebob'        THEN 5000
    WHEN 'elvenlake'        THEN 4000
    WHEN 'titan'            THEN 5000
    WHEN 'market_village'   THEN 5000
    WHEN 'ittihad'          THEN 5000
    WHEN 'shabab'           THEN 5000
    WHEN 'nassr'            THEN 5000
    WHEN 'ahli'             THEN 5000
    WHEN 'madagascar'       THEN 4000
    WHEN 'worldcup'         THEN 700000
    ELSE NULL
  END;
  IF _server_price IS NULL THEN RAISE EXCEPTION 'bg_not_purchasable_with_gems'; END IF;

  _duration_days := CASE WHEN _bg_id = 'worldcup' THEN NULL ELSE 7 END;

  SELECT gems INTO _have FROM public.profiles WHERE id=_uid FOR UPDATE;
  IF _have IS NULL OR _have < _server_price THEN RAISE EXCEPTION 'not_enough_gems'; END IF;
  UPDATE public.profiles SET gems = gems - _server_price WHERE id=_uid;

  SELECT EXISTS(
    SELECT 1 FROM public.legacy_cosmetics
     WHERE user_id=_uid AND item_type='background' AND item_id=_bg_id
  ) INTO _is_legacy;

  SELECT EXISTS(
    SELECT 1 FROM public.inventory
     WHERE user_id=_uid AND item_type='background' AND item_id=_bg_id
  ) INTO _has_row;

  IF _has_row THEN
    IF _is_legacy OR _duration_days IS NULL THEN
      UPDATE public.inventory
         SET meta = COALESCE(meta,'{}'::jsonb) - 'expires_at'
       WHERE user_id=_uid AND item_type='background' AND item_id=_bg_id;
    ELSE
      UPDATE public.inventory
         SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('expires_at', (now() + make_interval(days => _duration_days))::text),
             acquired_at = now()
       WHERE user_id=_uid AND item_type='background' AND item_id=_bg_id;
    END IF;
  ELSE
    INSERT INTO public.inventory(user_id, item_type, item_id, qty, acquired_at, meta)
    VALUES (
      _uid, 'background', _bg_id, 1, now(),
      CASE WHEN _duration_days IS NULL THEN '{}'::jsonb
           ELSE jsonb_build_object('expires_at', (now() + make_interval(days => _duration_days))::text) END
    );
  END IF;
END $function$;