
-- 1) Reduce all frame/name_frame/bubble_frame/profile_frame prices by 30% (fixed)
UPDATE public.client_item_prices
   SET price_gems = GREATEST(1, CEIL(price_gems * 0.7))
 WHERE item_type IN ('frame','name_frame','bubble_frame','profile_frame');

-- 2) Fix buy_with_gems (both variants) to charge the stored price exactly for frames/backgrounds
CREATE OR REPLACE FUNCTION public.buy_with_gems(_item_id text, _item_type text, _gems_cost integer, _meta jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price integer; _fixed boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;
  SELECT price_gems INTO _price FROM public.client_item_prices
    WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_gems INTO _price FROM public.items_catalog
      WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'item not buyable with gems: %', _item_id; END IF;
  _fixed := _item_type IN ('frame','background','name_frame');
  IF NOT _fixed THEN
    _price := CEIL(public.get_effective_shop_price(_uid, _price::numeric))::int;
  END IF;
  PERFORM public._mutate_currency(_uid, 0, -_price, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, 1, _meta)
    ON CONFLICT DO NOTHING;
END $function$;

CREATE OR REPLACE FUNCTION public.buy_with_gems(_item_id text, _item_type text, _gems_cost integer, _meta jsonb DEFAULT NULL::jsonb, _count integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price integer; _total bigint; _is_frame boolean; _new_meta jsonb; _fixed boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _count IS NULL OR _count < 1 OR _count > 999 THEN RAISE EXCEPTION 'bad count'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame','bubble_frame','profile_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;
  SELECT price_gems INTO _price FROM public.client_item_prices
    WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_gems INTO _price FROM public.items_catalog
      WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'item not buyable with gems: %', _item_id; END IF;
  IF _item_type IN ('frame','background','name_frame','bubble_frame','profile_frame') THEN _count := 1; END IF;
  _fixed := _item_type IN ('frame','background','name_frame','bubble_frame','profile_frame');
  IF _fixed THEN
    _total := (_price::bigint) * _count;
  ELSE
    _total := CEIL(public.get_effective_shop_price(_uid, ((_price::bigint) * _count)::numeric))::bigint;
  END IF;
  PERFORM public._mutate_currency(_uid, 0, -_total::integer, 0, 0);

  _is_frame := _item_type IN ('frame','name_frame','bubble_frame','profile_frame');
  _new_meta := COALESCE(_meta, '{}'::jsonb);
  IF _is_frame THEN
    _new_meta := _new_meta || jsonb_build_object('expires_at', (now() + interval '30 days')::text);
  END IF;

  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, _count, _new_meta)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
  DO UPDATE
    SET quantity = CASE WHEN _is_frame THEN 1 ELSE public.inventory.quantity + EXCLUDED.quantity END,
        meta = CASE
          WHEN _is_frame THEN COALESCE(public.inventory.meta,'{}'::jsonb) || jsonb_build_object('expires_at', (now() + interval '30 days')::text)
          ELSE COALESCE(EXCLUDED.meta, public.inventory.meta)
        END,
        acquired_at = CASE WHEN _is_frame THEN now() ELSE public.inventory.acquired_at END;
END $function$;

-- 3) buy_background_gems: hilal back to 7 days, all prices at 30% off, fixed (no VIP shop multiplier)
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
    WHEN 'eiffel_night'     THEN 7000
    WHEN 'crystal_kingdom'  THEN 7000
    WHEN 'eiffel'           THEN 3500
    WHEN 'hilal'            THEN 7700
    WHEN 'worldcup'         THEN 700000
    ELSE NULL
  END;
  IF _server_price IS NULL THEN RAISE EXCEPTION 'bg_not_purchasable_with_gems'; END IF;

  -- worldcup remains permanent; all other paid backgrounds (incl. hilal) are 7-day timed
  _duration_days := CASE WHEN _bg_id = 'worldcup' THEN NULL ELSE 7 END;

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

-- 4) Set all current Al-Hilal owners to expire 7 days from now
UPDATE public.inventory
   SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('expires_at', (now() + interval '7 days')::text)
 WHERE item_type = 'background' AND item_id = 'hilal';
