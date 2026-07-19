
-- 1) buy_with_gems: frame purchases become 30-day timed (upsert extends expiry from now)
CREATE OR REPLACE FUNCTION public.buy_with_gems(_item_id text, _item_type text, _gems_cost integer, _meta jsonb DEFAULT NULL::jsonb, _count integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price integer; _total bigint; _is_frame boolean; _new_meta jsonb;
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
  _total := CEIL(public.get_effective_shop_price(_uid, ((_price::bigint) * _count)::numeric))::bigint;
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

-- 2) buy_background_gems: all paid backgrounds are 7-day timed
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
  _duration_days int := 7; -- all paid backgrounds are timed for 7 days
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

  _server_price := CEIL(public.get_effective_shop_price(_uid, _server_price::numeric))::bigint;
  SELECT gems INTO _have FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _have IS NULL OR _have < _server_price THEN RAISE EXCEPTION 'not_enough_gems'; END IF;
  UPDATE public.profiles SET gems = gems - _server_price WHERE id = _uid;

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
END
$function$;

-- 3) Backfill: existing frame owners get 30 days from now if no expiry set
UPDATE public.inventory
   SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('expires_at', (now() + interval '30 days')::text)
 WHERE item_type IN ('frame','name_frame','bubble_frame','profile_frame')
   AND (meta IS NULL OR (meta->>'expires_at') IS NULL);

-- 4) Backfill: existing paid backgrounds get 7 days from now if no expiry set
UPDATE public.inventory
   SET meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('expires_at', (now() + interval '7 days')::text)
 WHERE item_type = 'background'
   AND item_id <> 'onepiece'
   AND (meta IS NULL OR (meta->>'expires_at') IS NULL);

-- 5) Cleanup function: removes expired frames/backgrounds and resets equipped fields
CREATE OR REPLACE FUNCTION public.cleanup_expired_cosmetics()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  -- Reset selected background to default for users whose selected bg has expired
  UPDATE public.profiles p
     SET selected_bg_id = 'onepiece'
   WHERE p.selected_bg_id IS NOT NULL
     AND p.selected_bg_id <> 'onepiece'
     AND EXISTS (
       SELECT 1 FROM public.inventory i
        WHERE i.user_id = p.id
          AND i.item_type = 'background'
          AND i.item_id = p.selected_bg_id
          AND (i.meta->>'expires_at')::timestamptz <= now()
     );

  -- Reset equipped frames when the corresponding inventory row is expired
  UPDATE public.profiles p
     SET avatar_frame = NULL
   WHERE p.avatar_frame IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.inventory i
        WHERE i.user_id = p.id AND i.item_type='frame' AND i.item_id = p.avatar_frame
          AND (i.meta->>'expires_at')::timestamptz <= now()
     );
  UPDATE public.profiles p
     SET name_frame = NULL
   WHERE p.name_frame IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.inventory i
        WHERE i.user_id = p.id AND i.item_type='name_frame' AND i.item_id = p.name_frame
          AND (i.meta->>'expires_at')::timestamptz <= now()
     );
  UPDATE public.profiles p
     SET bubble_frame = NULL
   WHERE p.bubble_frame IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.inventory i
        WHERE i.user_id = p.id AND i.item_type='bubble_frame' AND i.item_id = p.bubble_frame
          AND (i.meta->>'expires_at')::timestamptz <= now()
     );
  UPDATE public.profiles p
     SET profile_frame = NULL
   WHERE p.profile_frame IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.inventory i
        WHERE i.user_id = p.id AND i.item_type='profile_frame' AND i.item_id = p.profile_frame
          AND (i.meta->>'expires_at')::timestamptz <= now()
     );

  -- Delete all expired cosmetic rows
  DELETE FROM public.inventory
   WHERE item_type IN ('frame','name_frame','bubble_frame','profile_frame','background')
     AND (meta->>'expires_at') IS NOT NULL
     AND (meta->>'expires_at')::timestamptz <= now();
END $$;

-- 6) Per-user self-heal (callable from client on load)
CREATE OR REPLACE FUNCTION public.cleanup_my_expired_cosmetics()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;

  UPDATE public.profiles SET selected_bg_id='onepiece'
   WHERE id=_uid AND selected_bg_id IS NOT NULL AND selected_bg_id<>'onepiece'
     AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.user_id=_uid AND i.item_type='background' AND i.item_id=selected_bg_id AND (i.meta->>'expires_at')::timestamptz <= now());

  UPDATE public.profiles SET avatar_frame=NULL WHERE id=_uid AND avatar_frame IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.user_id=_uid AND i.item_type='frame' AND i.item_id=avatar_frame AND (i.meta->>'expires_at')::timestamptz <= now());
  UPDATE public.profiles SET name_frame=NULL WHERE id=_uid AND name_frame IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.user_id=_uid AND i.item_type='name_frame' AND i.item_id=name_frame AND (i.meta->>'expires_at')::timestamptz <= now());
  UPDATE public.profiles SET bubble_frame=NULL WHERE id=_uid AND bubble_frame IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.user_id=_uid AND i.item_type='bubble_frame' AND i.item_id=bubble_frame AND (i.meta->>'expires_at')::timestamptz <= now());
  UPDATE public.profiles SET profile_frame=NULL WHERE id=_uid AND profile_frame IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.inventory i WHERE i.user_id=_uid AND i.item_type='profile_frame' AND i.item_id=profile_frame AND (i.meta->>'expires_at')::timestamptz <= now());

  DELETE FROM public.inventory
   WHERE user_id=_uid
     AND item_type IN ('frame','name_frame','bubble_frame','profile_frame','background')
     AND (meta->>'expires_at') IS NOT NULL
     AND (meta->>'expires_at')::timestamptz <= now();
END $$;

GRANT EXECUTE ON FUNCTION public.cleanup_my_expired_cosmetics() TO authenticated;

-- 7) Schedule bulk cleanup every 5 minutes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule('cleanup_expired_cosmetics_5m') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='cleanup_expired_cosmetics_5m');
    PERFORM cron.schedule('cleanup_expired_cosmetics_5m', '*/5 * * * *', $cron$SELECT public.cleanup_expired_cosmetics();$cron$);
  END IF;
END $$;
