CREATE OR REPLACE FUNCTION public.buy_with_gems(_item_id text, _item_type text, _gems_cost integer, _meta jsonb DEFAULT NULL::jsonb, _count integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price integer; _total bigint; _is_frame boolean;  _new_meta jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF; PERFORM public.assert_email_verified();
  IF _count IS NULL OR _count < 1 OR _count > 999 THEN RAISE EXCEPTION 'bad count'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame','bubble_frame','profile_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;
  IF _item_type = 'weapon' AND _count > 10 THEN RAISE EXCEPTION 'max_per_order:10'; END IF;
  SELECT price_gems INTO _price FROM public.client_item_prices
    WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_gems INTO _price FROM public.items_catalog
      WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'item not buyable with gems: %', _item_id; END IF;
  IF _item_type IN ('frame','background','name_frame','bubble_frame','profile_frame') THEN _count := 1; END IF;
  -- No daily purchase quota when paying with gems.
  _total := (_price::bigint) * _count;
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