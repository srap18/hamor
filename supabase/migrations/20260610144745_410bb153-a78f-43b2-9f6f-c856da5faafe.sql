
-- ============= 1. Combat multiplier in record_attack =============
CREATE OR REPLACE FUNCTION public.record_attack(_defender_id uuid, _target_ship_id uuid, _damage integer, _damage_dealt integer, _attacker_won boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _id uuid; _def_prot timestamptz; _def_gf timestamptz; _mult numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;

  SELECT protection_until, golden_fisher_until INTO _def_prot, _def_gf
    FROM public.profiles WHERE id = _defender_id;
  IF (_def_prot IS NOT NULL AND _def_prot > now())
     OR (_def_gf IS NOT NULL AND _def_gf > now()) THEN
    RAISE EXCEPTION 'defender_protected';
  END IF;

  UPDATE public.profiles
    SET protection_until = NULL
    WHERE id = _uid AND protection_until IS NOT NULL AND protection_until > now()
      AND (golden_fisher_until IS NULL OR golden_fisher_until <= now());

  _mult := public.get_combat_multiplier(_uid);
  _damage := LEAST(10000000, GREATEST(0, FLOOR(_damage::numeric * _mult)::int));
  _damage_dealt := LEAST(_damage, GREATEST(0, FLOOR(_damage_dealt::numeric * _mult)::int));

  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;
  RETURN _id;
END $function$;

CREATE OR REPLACE FUNCTION public.record_attack(_defender_id uuid, _target_ship_id uuid, _damage integer, _damage_dealt integer, _attacker_won boolean, _xp_gain integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _id uuid; _xp int; _def_prot timestamptz; _def_gf timestamptz; _mult numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;
  _xp := GREATEST(0, LEAST(COALESCE(_xp_gain, 0), 100000));

  SELECT protection_until, golden_fisher_until INTO _def_prot, _def_gf
    FROM public.profiles WHERE id = _defender_id;
  IF (_def_prot IS NOT NULL AND _def_prot > now())
     OR (_def_gf IS NOT NULL AND _def_gf > now()) THEN
    RAISE EXCEPTION 'defender_protected';
  END IF;

  UPDATE public.profiles
    SET protection_until = NULL
    WHERE id = _uid AND protection_until IS NOT NULL AND protection_until > now()
      AND (golden_fisher_until IS NULL OR golden_fisher_until <= now());

  _mult := public.get_combat_multiplier(_uid);
  _damage := LEAST(10000000, GREATEST(0, FLOOR(_damage::numeric * _mult)::int));
  _damage_dealt := LEAST(_damage, GREATEST(0, FLOOR(_damage_dealt::numeric * _mult)::int));

  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;

  IF _xp > 0 THEN
    UPDATE public.profiles SET xp = COALESCE(xp,0) + _xp WHERE id = _uid;
  END IF;
  RETURN _id;
END $function$;

-- ============= 2. Shop discount in buy_* functions =============

CREATE OR REPLACE FUNCTION public.buy_with_coins(_item_id text, _item_type text, _coins_cost bigint, _meta jsonb DEFAULT NULL::jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;
  SELECT price_coins INTO _price FROM public.client_item_prices
    WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_coins INTO _price FROM public.items_catalog
      WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'item not buyable with coins: %', _item_id; END IF;
  _price := CEIL(public.get_effective_shop_price(_uid, _price::numeric))::bigint;
  PERFORM public._mutate_currency(_uid, -_price, 0, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, 1, _meta)
    ON CONFLICT DO NOTHING;
END $function$;

CREATE OR REPLACE FUNCTION public.buy_with_coins(_item_id text, _item_type text, _coins_cost bigint, _meta jsonb DEFAULT NULL::jsonb, _count integer DEFAULT 1)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price bigint; _total bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _count IS NULL OR _count < 1 OR _count > 999 THEN RAISE EXCEPTION 'bad count'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;
  SELECT price_coins INTO _price FROM public.client_item_prices
    WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_coins INTO _price FROM public.items_catalog
      WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'item not buyable with coins: %', _item_id; END IF;
  IF _item_type IN ('frame','background','name_frame') THEN _count := 1; END IF;
  _total := CEIL(public.get_effective_shop_price(_uid, (_price * _count)::numeric))::bigint;
  PERFORM public._mutate_currency(_uid, -_total, 0, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, _count, _meta)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
  DO UPDATE
    SET quantity = public.inventory.quantity + EXCLUDED.quantity,
        meta = COALESCE(EXCLUDED.meta, public.inventory.meta);
END $function$;

CREATE OR REPLACE FUNCTION public.buy_with_gems(_item_id text, _item_type text, _gems_cost integer, _meta jsonb DEFAULT NULL::jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price integer;
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
  _price := CEIL(public.get_effective_shop_price(_uid, _price::numeric))::int;
  PERFORM public._mutate_currency(_uid, 0, -_price, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, 1, _meta)
    ON CONFLICT DO NOTHING;
END $function$;

CREATE OR REPLACE FUNCTION public.buy_with_gems(_item_id text, _item_type text, _gems_cost integer, _meta jsonb DEFAULT NULL::jsonb, _count integer DEFAULT 1)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price integer; _total bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _count IS NULL OR _count < 1 OR _count > 999 THEN RAISE EXCEPTION 'bad count'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;
  SELECT price_gems INTO _price FROM public.client_item_prices
    WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_gems INTO _price FROM public.items_catalog
      WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'item not buyable with gems: %', _item_id; END IF;
  IF _item_type IN ('frame','background','name_frame') THEN _count := 1; END IF;
  _total := CEIL(public.get_effective_shop_price(_uid, ((_price::bigint) * _count)::numeric))::bigint;
  PERFORM public._mutate_currency(_uid, 0, -_total::integer, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, _count, _meta)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
  DO UPDATE
    SET quantity = public.inventory.quantity + EXCLUDED.quantity,
        meta = COALESCE(EXCLUDED.meta, public.inventory.meta);
END $function$;

CREATE OR REPLACE FUNCTION public.buy_catalog_item(_item_id text, _item_type text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price_c bigint; _price_g int; _kind text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT price_coins, price_gems, kind INTO _price_c, _price_g, _kind
    FROM public.items_catalog WHERE code = _item_id AND active = true;
  IF _price_c IS NULL THEN
    RAISE EXCEPTION 'item not in catalog: %', _item_id;
  END IF;
  _price_c := CEIL(public.get_effective_shop_price(_uid, _price_c::numeric))::bigint;
  _price_g := CEIL(public.get_effective_shop_price(_uid, _price_g::numeric))::int;
  PERFORM public._mutate_currency(_uid, -_price_c, -_price_g, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity)
    VALUES (_uid, _item_type, _item_id, 1)
    ON CONFLICT DO NOTHING;
END $function$;

CREATE OR REPLACE FUNCTION public.buy_lootbox(_type_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _c bigint; _g int; _new uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT cost_coins, cost_gems INTO _c, _g FROM public.lootbox_types WHERE id = _type_id AND active = true;
  IF _c IS NULL THEN RAISE EXCEPTION 'lootbox not found'; END IF;
  _c := CEIL(public.get_effective_shop_price(_uid, _c::numeric))::bigint;
  _g := CEIL(public.get_effective_shop_price(_uid, _g::numeric))::int;
  PERFORM public._mutate_currency(_uid, -_c, -_g, 0, 0);
  INSERT INTO public.lootbox_owned(user_id, type_id) VALUES (_uid, _type_id) RETURNING id INTO _new;
  RETURN _new;
END $function$;

CREATE OR REPLACE FUNCTION public.buy_background(_bg_id text, _price bigint)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _already boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  IF _price < 0 OR _price > 100000000000 THEN RAISE EXCEPTION 'bad price'; END IF;
  IF _bg_id IN ('eiffel_night','crystal_kingdom') THEN
    RAISE EXCEPTION 'gems_only_background';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.inventory
     WHERE user_id = _uid AND item_type = 'background' AND item_id = _bg_id
  ) INTO _already;
  IF NOT _already THEN
    _price := CEIL(public.get_effective_shop_price(_uid, _price::numeric))::bigint;
    PERFORM public._pay_coins_with_gem_fallback(_uid, _price);
    INSERT INTO public.inventory(user_id, item_type, item_id, quantity)
    VALUES (_uid, 'background', _bg_id, 1);
  END IF;
  UPDATE public.profiles SET selected_bg_id = _bg_id WHERE id = _uid;
END $function$;

CREATE OR REPLACE FUNCTION public.buy_background_gems(_bg_id text, _gems bigint)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _have bigint; _already boolean; _server_price bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth'; END IF;
  _server_price := CASE _bg_id
    WHEN 'eiffel_night'     THEN 10000
    WHEN 'crystal_kingdom'  THEN 10000
    WHEN 'eiffel'           THEN 5000
    ELSE NULL
  END;
  IF _server_price IS NULL THEN RAISE EXCEPTION 'bg_not_purchasable_with_gems'; END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION public.buy_ship_by_code(_code text, _template_id integer, _price_coins bigint, _max_hp integer)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _new uuid; _market_level int;
  _active_count int; _storage_count int; _put_in_storage boolean := false;
  _cur_coins bigint; _cur_gems integer; _coins_to_spend bigint;
  _gems_to_spend integer := 0; _shortfall bigint; _cat record;
  _required_level int; _stored_template int; _stored_hp int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _price_coins < 0 OR _price_coins > 100000000000 THEN RAISE EXCEPTION 'bad price'; END IF;
  IF _max_hp < 50 OR _max_hp > 1000000 THEN RAISE EXCEPTION 'bad hp'; END IF;
  IF _template_id < 1 OR _template_id > 100 THEN RAISE EXCEPTION 'bad template'; END IF;

  SELECT * INTO _cat FROM public.ship_catalog WHERE code = _code AND active = true LIMIT 1;
  _required_level := COALESCE(_cat.market_level_required, _template_id);
  _stored_template := COALESCE(_cat.sort_order, _template_id);
  _stored_hp := CASE
    WHEN _code = 'upgrade-sub' THEN public.submarine_capacity_for_stars(1)
    WHEN _code = 'submarine' THEN _max_hp
    ELSE _max_hp END;

  SELECT level INTO _market_level FROM public.user_market WHERE user_id = _uid;
  IF _market_level IS NULL THEN _market_level := 1; END IF;
  IF _required_level > _market_level THEN RAISE EXCEPTION 'market level too low'; END IF;

  SELECT
    COUNT(*) FILTER (WHERE NOT in_storage),
    COUNT(*) FILTER (WHERE in_storage)
  INTO _active_count, _storage_count
  FROM public.ships_owned WHERE user_id = _uid;

  IF _active_count >= 3 THEN
    IF _storage_count >= 3 THEN RAISE EXCEPTION 'fleet and storage full'; END IF;
    _put_in_storage := true;
  END IF;

  _price_coins := CEIL(public.get_effective_shop_price(_uid, _price_coins::numeric))::bigint;

  SELECT coins, gems INTO _cur_coins, _cur_gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _cur_coins IS NULL THEN RAISE EXCEPTION 'no profile'; END IF;

  IF _cur_coins >= _price_coins THEN
    _coins_to_spend := _price_coins;
    _gems_to_spend := 0;
  ELSE
    _coins_to_spend := _cur_coins;
    _shortfall := _price_coins - _cur_coins;
    _gems_to_spend := CEIL(_shortfall::numeric / 1000.0)::int;
    IF _cur_gems < _gems_to_spend THEN RAISE EXCEPTION 'insufficient coins and gems'; END IF;
  END IF;

  PERFORM public._mutate_currency(_uid, -_coins_to_spend, -_gems_to_spend, 0, 0);
  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp, in_storage, stars, max_stars)
    VALUES (_uid, _stored_template, _code, false, _stored_hp, _stored_hp, _put_in_storage, 1, CASE WHEN _code = 'upgrade-sub' THEN 1 ELSE 1 END)
    RETURNING id INTO _new;
  RETURN _new;
END $function$;

-- ============= 3. Daily gems claim for Elite VIP =============

CREATE TABLE IF NOT EXISTS public.elite_vip_daily_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claim_date date NOT NULL,
  level smallint NOT NULL,
  gems integer NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, claim_date)
);

GRANT SELECT ON public.elite_vip_daily_claims TO authenticated;
GRANT ALL ON public.elite_vip_daily_claims TO service_role;
ALTER TABLE public.elite_vip_daily_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their elite vip claims" ON public.elite_vip_daily_claims;
CREATE POLICY "Users read their elite vip claims" ON public.elite_vip_daily_claims
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.claim_elite_vip_daily_gems()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_level smallint;
  v_gems int;
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  v_level := public.get_elite_vip_level(v_user);
  IF v_level < 1 THEN RAISE EXCEPTION 'no_elite_vip'; END IF;

  SELECT daily_gems INTO v_gems FROM public.elite_vip_tier_config WHERE level = v_level;
  IF v_gems IS NULL OR v_gems <= 0 THEN RAISE EXCEPTION 'no_daily_gems_configured'; END IF;

  BEGIN
    INSERT INTO public.elite_vip_daily_claims(user_id, claim_date, level, gems)
    VALUES (v_user, v_today, v_level, v_gems);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_claimed_today';
  END;

  PERFORM public._mutate_currency(v_user, 0, v_gems, 0, 0);
  RETURN jsonb_build_object('ok', true, 'gems', v_gems, 'level', v_level);
END $function$;
