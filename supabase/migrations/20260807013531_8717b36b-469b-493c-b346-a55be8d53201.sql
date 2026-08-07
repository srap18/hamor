-- 1) VIP discount applies to GOLD only: drop gem discounting everywhere.
CREATE OR REPLACE FUNCTION public.buy_with_gems(_item_id text, _item_type text, _gems_cost integer, _meta jsonb DEFAULT NULL::jsonb, _count integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price integer; _total bigint; _is_frame boolean;  _new_meta jsonb;
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
  -- No VIP discount on gems (gold only).
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

CREATE OR REPLACE FUNCTION public.buy_catalog_item(_item_id text, _item_type text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price_c bigint; _price_g int; _kind text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT price_coins, price_gems, kind INTO _price_c, _price_g, _kind
    FROM public.items_catalog WHERE code = _item_id AND active = true;
  IF _price_c IS NULL THEN
    RAISE EXCEPTION 'item not in catalog: %', _item_id;
  END IF;
  -- VIP discount on gold only.
  _price_c := CEIL(public.get_effective_shop_price(_uid, _price_c::numeric))::bigint;
  PERFORM public._mutate_currency(_uid, -_price_c, -_price_g, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity)
    VALUES (_uid, _item_type, _item_id, 1)
    ON CONFLICT DO NOTHING;
END $function$;

CREATE OR REPLACE FUNCTION public.buy_lootbox(_type_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _c bigint; _g int; _new uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT cost_coins, cost_gems INTO _c, _g FROM public.lootbox_types WHERE id = _type_id AND active = true;
  IF _c IS NULL THEN RAISE EXCEPTION 'lootbox not found'; END IF;
  -- VIP discount on gold only.
  _c := CEIL(public.get_effective_shop_price(_uid, _c::numeric))::bigint;
  PERFORM public._mutate_currency(_uid, -_c, -_g, 0, 0);
  INSERT INTO public.lootbox_owned(user_id, type_id) VALUES (_uid, _type_id) RETURNING id INTO _new;
  RETURN _new;
END $function$;

-- 2) Cashback must respect VIP expiry.
CREATE OR REPLACE FUNCTION public.award_vip_cashback(_uid uuid, _gold_spent bigint, _source text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _lvl int; _pct int; _amt bigint;
BEGIN
  IF _uid IS NULL OR _gold_spent IS NULL OR _gold_spent <= 0 THEN RETURN 0; END IF;
  SELECT CASE
           WHEN elite_vip_expires_at IS NOT NULL AND elite_vip_expires_at <= now() THEN 0
           ELSE COALESCE(elite_vip_level, 0)
         END INTO _lvl FROM public.profiles WHERE id = _uid;
  IF _lvl < 1 THEN RETURN 0; END IF;
  SELECT COALESCE(cashback_pct, 0) INTO _pct FROM public.elite_vip_tier_config WHERE level = _lvl;
  IF _pct <= 0 THEN RETURN 0; END IF;
  _amt := FLOOR(_gold_spent::numeric * _pct / 100.0)::bigint;
  IF _amt <= 0 THEN RETURN 0; END IF;
  PERFORM public._mutate_currency(_uid, _amt, 0, 0, 0);
  RETURN _amt;
END $function$;

-- 3) Ship purchases no longer grant VIP cashback.
CREATE OR REPLACE FUNCTION public.buy_ship_by_code(_code text, _template_id integer, _price_coins bigint, _max_hp integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _new uuid;
  _market_level int;
  _active_count int;
  _storage_count int;
  _storage_capacity int;
  _put_in_storage boolean := false;
  _cur_coins bigint;
  _cat record;
  _required_level int;
  _stored_template int;
  _stored_hp int;
  _server_price bigint;
  _server_hp int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _cat FROM public.ship_catalog WHERE code = _code AND active = true LIMIT 1;
  IF _cat.code IS NULL THEN RAISE EXCEPTION 'unknown ship code'; END IF;

  _server_price := COALESCE(_cat.price_coins, 0);
  IF _server_price <= 0 THEN RAISE EXCEPTION 'ship not purchasable with coins'; END IF;

  _required_level := COALESCE(_cat.market_level_required, 1);
  _stored_template := COALESCE(_cat.sort_order, _template_id);
  _server_hp := CASE
    WHEN _code = 'upgrade-sub' THEN public.submarine_capacity_for_stars(1)
    WHEN _code = 'submarine' THEN COALESCE(_cat.max_hp, 100)
    ELSE COALESCE(_cat.max_hp, 100)
  END;
  _stored_hp := _server_hp;

  SELECT level INTO _market_level FROM public.user_market WHERE user_id = _uid;
  IF _market_level IS NULL THEN _market_level := 1; END IF;
  IF _required_level > _market_level THEN RAISE EXCEPTION 'market level too low'; END IF;

  SELECT COALESCE(storage_capacity, 3) INTO _storage_capacity FROM public.profiles WHERE id = _uid;
  IF _storage_capacity IS NULL THEN _storage_capacity := 3; END IF;

  SELECT COUNT(*) FILTER (WHERE NOT in_storage), COUNT(*) FILTER (WHERE in_storage)
    INTO _active_count, _storage_count
    FROM public.ships_owned WHERE user_id = _uid;

  IF _active_count >= 3 THEN
    IF _storage_count >= _storage_capacity THEN RAISE EXCEPTION 'fleet and storage full'; END IF;
    _put_in_storage := true;
  END IF;

  SELECT coins INTO _cur_coins FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _cur_coins IS NULL THEN RAISE EXCEPTION 'no profile'; END IF;
  IF _cur_coins < _server_price THEN RAISE EXCEPTION 'insufficient coins'; END IF;

  PERFORM public._mutate_currency(_uid, -_server_price, 0, 0, 0);
  -- No VIP cashback on ship purchases.

  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp, in_storage, stars, max_stars)
  VALUES (_uid, _stored_template, _code, false, _stored_hp, _stored_hp, _put_in_storage, 1, 1)
  RETURNING id INTO _new;

  RETURN _new;
END;
$function$;