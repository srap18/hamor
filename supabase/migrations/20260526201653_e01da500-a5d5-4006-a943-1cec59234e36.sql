CREATE OR REPLACE FUNCTION public.delete_inventory_rows(_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _n int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  DELETE FROM public.inventory WHERE id = ANY(_ids) AND user_id = _uid;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
GRANT EXECUTE ON FUNCTION public.delete_inventory_rows(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.split_inventory_assign(_inv_id uuid, _new_meta jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _row record; _new_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _row FROM public.inventory WHERE id = _inv_id FOR UPDATE;
  IF _row.user_id <> _uid THEN RAISE EXCEPTION 'not your item'; END IF;
  IF _row.quantity < 1 THEN RAISE EXCEPTION 'empty stack'; END IF;
  IF _row.quantity = 1 THEN
    UPDATE public.inventory SET meta = _new_meta WHERE id = _inv_id;
    RETURN _inv_id;
  END IF;
  UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _inv_id;
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _row.item_type, _row.item_id, 1, _new_meta)
    RETURNING id INTO _new_id;
  RETURN _new_id;
END $$;
GRANT EXECUTE ON FUNCTION public.split_inventory_assign(uuid, jsonb) TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS fish_caught_user_fish_uniq ON public.fish_caught(user_id, fish_id);

CREATE OR REPLACE FUNCTION public.increment_fish_caught(_fish_id text, _qty integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty < 1 OR _qty > 10000 THEN RAISE EXCEPTION 'bad qty'; END IF;
  INSERT INTO public.fish_caught(user_id, fish_id, quantity) VALUES (_uid, _fish_id, _qty)
  ON CONFLICT (user_id, fish_id) DO UPDATE SET quantity = public.fish_caught.quantity + _qty, updated_at = now();
END $$;
GRANT EXECUTE ON FUNCTION public.increment_fish_caught(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_player_currency(
  _player uuid, _coins bigint, _gems integer, _xp integer, _level integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;
  UPDATE public.profiles
    SET coins = _coins, gems = _gems, xp = _xp, level = _level
  WHERE id = _player;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_set_player_currency(uuid, bigint, integer, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_grant_lootbox(_player uuid, _type_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;
  INSERT INTO public.lootbox_owned(user_id, type_id) VALUES (_player, _type_id) RETURNING id INTO _id;
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_grant_lootbox(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_mass_gift(_coins bigint, _gems integer, _xp integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;
  UPDATE public.profiles
    SET coins = coins + GREATEST(0, _coins),
        gems = gems + GREATEST(0, _gems),
        xp = GREATEST(0, xp + _xp),
        level = GREATEST(1, FLOOR(SQRT(GREATEST(0, xp + _xp) / 100.0))::int + 1);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_mass_gift(bigint, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.market_start_upgrade()
RETURNS TABLE(new_level int, ends_at timestamptz, cost_coins bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _cur record; _cost bigint; _secs int; _end timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  PERFORM public.finalize_market_upgrades();
  SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL THEN
    INSERT INTO public.user_market(user_id, level) VALUES (_uid, 1) ON CONFLICT DO NOTHING;
    SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  END IF;
  IF _cur.upgrading_to IS NOT NULL THEN RAISE EXCEPTION 'already upgrading'; END IF;
  IF _cur.level >= 30 THEN RAISE EXCEPTION 'max level'; END IF;
  SELECT muc.cost_coins, muc.seconds INTO _cost, _secs FROM public.market_upgrade_cost(_cur.level) AS muc;
  _end := now() + make_interval(secs => _secs);
  PERFORM public._mutate_currency(_uid, -_cost, 0, 0, 0);
  UPDATE public.user_market
    SET upgrading_to = _cur.level + 1, upgrade_started_at = now(),
        upgrade_ends_at = _end, upgrade_cost_coins = _cost, updated_at = now()
    WHERE user_id = _uid;
  RETURN QUERY SELECT (_cur.level + 1), _end, _cost;
END $$;
GRANT EXECUTE ON FUNCTION public.market_start_upgrade() TO authenticated;

CREATE OR REPLACE FUNCTION public.market_finish_upgrade_with_gems()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _cur record; _secs_left int; _gems int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL OR _cur.upgrading_to IS NULL THEN RAISE EXCEPTION 'no upgrade'; END IF;
  _secs_left := GREATEST(0, EXTRACT(EPOCH FROM (_cur.upgrade_ends_at - now()))::int);
  _gems := GREATEST(1, CEIL(_secs_left::numeric / 60))::int;
  PERFORM public._mutate_currency(_uid, 0, -_gems, 0, 0);
  UPDATE public.user_market
    SET level = upgrading_to, upgrading_to = NULL, upgrade_started_at = NULL,
        upgrade_ends_at = NULL, upgrade_cost_coins = NULL, updated_at = now()
    WHERE user_id = _uid;
  RETURN _gems;
END $$;
GRANT EXECUTE ON FUNCTION public.market_finish_upgrade_with_gems() TO authenticated;

-- Client item prices catalog
CREATE TABLE IF NOT EXISTS public.client_item_prices (
  item_type text NOT NULL,
  item_id   text NOT NULL,
  price_coins bigint NOT NULL DEFAULT 0,
  price_gems  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (item_type, item_id)
);
GRANT SELECT ON public.client_item_prices TO anon, authenticated;
GRANT ALL ON public.client_item_prices TO service_role;
ALTER TABLE public.client_item_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cip_all_view ON public.client_item_prices;
CREATE POLICY cip_all_view ON public.client_item_prices FOR SELECT USING (true);
DROP POLICY IF EXISTS cip_admin_manage ON public.client_item_prices;
CREATE POLICY cip_admin_manage ON public.client_item_prices FOR ALL
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

INSERT INTO public.client_item_prices(item_type,item_id,price_coins,price_gems) VALUES
  ('frame','af_bronze',0,500),('frame','af_silver',0,2000),('frame','af_gold',0,6000),
  ('frame','af_emerald',0,9000),('frame','af_ruby',0,18000),('frame','af_diamond',0,45000),
  ('frame','af_dragon',0,90000),('frame','af_phoenix',0,120000),('frame','af_imperial',0,200000),
  ('frame','nf_simple',0,300),('frame','nf_sky',0,1500),('frame','nf_gold',0,5000),
  ('frame','nf_emerald',0,8000),('frame','nf_royal',0,22000),('frame','nf_legend',0,60000),
  ('frame','nf_inferno',0,80000),('frame','nf_abyss',0,100000),
  ('name_frame','nf_simple',0,300),('name_frame','nf_sky',0,1500),('name_frame','nf_gold',0,5000),
  ('name_frame','nf_emerald',0,8000),('name_frame','nf_royal',0,22000),('name_frame','nf_legend',0,60000),
  ('name_frame','nf_inferno',0,80000),('name_frame','nf_abyss',0,100000),
  ('weapon','rocket_small',1500,0),('weapon','rocket_medium',15000,0),
  ('weapon','rocket_large',90000,0),('weapon','nuke',0,2500),
  ('crew','luck',8000,0),('crew','guide',5000,0),('crew','thief',0,300),
  ('crew','sailor',3000,0),('crew','trader',0,250),('crew','police',0,200),
  ('crew','fixer_1',4000,0),('crew','fixer_2',15000,0),('crew','fixer_3',0,500),
  ('background','harbor',0,0),('background','sunset',25000,0),('background','tropical',60000,0),
  ('background','arctic',150000,0),('background','night',280000,0),
  ('background','cursed',500000,0),('background','volcano',1200000,0),('background','royal',3500000,0)
ON CONFLICT (item_type,item_id) DO UPDATE
  SET price_coins = EXCLUDED.price_coins, price_gems = EXCLUDED.price_gems;

-- Replace buy_with_coins / buy_with_gems with server-priced versions
DROP FUNCTION IF EXISTS public.buy_with_coins(text, text, bigint, jsonb);
DROP FUNCTION IF EXISTS public.buy_with_gems(text, text, integer, jsonb);

CREATE OR REPLACE FUNCTION public.buy_with_coins(
  _item_id text, _item_type text, _coins_cost bigint, _meta jsonb DEFAULT NULL, _count integer DEFAULT 1
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  _total := _price * _count;
  PERFORM public._mutate_currency(_uid, -_total, 0, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, _count, _meta)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
  DO UPDATE
    SET quantity = public.inventory.quantity + EXCLUDED.quantity,
        meta = COALESCE(EXCLUDED.meta, public.inventory.meta);
END $$;
GRANT EXECUTE ON FUNCTION public.buy_with_coins(text, text, bigint, jsonb, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.buy_with_gems(
  _item_id text, _item_type text, _gems_cost integer, _meta jsonb DEFAULT NULL, _count integer DEFAULT 1
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  _total := (_price::bigint) * _count;
  PERFORM public._mutate_currency(_uid, 0, -_total::integer, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, _count, _meta)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
  DO UPDATE
    SET quantity = public.inventory.quantity + EXCLUDED.quantity,
        meta = COALESCE(EXCLUDED.meta, public.inventory.meta);
END $$;
GRANT EXECUTE ON FUNCTION public.buy_with_gems(text, text, integer, jsonb, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.consume_inventory_item(_item_id text, _item_type text, _count integer DEFAULT 1)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _qty int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _count < 1 OR _count > 100 THEN RAISE EXCEPTION 'bad count'; END IF;
  SELECT quantity INTO _qty FROM public.inventory
    WHERE user_id = _uid AND item_id = _item_id AND item_type = _item_type
      AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
    FOR UPDATE;
  IF _qty IS NULL OR _qty < _count THEN RAISE EXCEPTION 'not enough items'; END IF;
  IF _qty - _count <= 0 THEN
    DELETE FROM public.inventory WHERE user_id = _uid AND item_id = _item_id AND item_type = _item_type
      AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL);
  ELSE
    UPDATE public.inventory SET quantity = quantity - _count
      WHERE user_id = _uid AND item_id = _item_id AND item_type = _item_type
        AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL);
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.consume_inventory_item(text, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_inventory_meta(_inv_id uuid, _meta jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT user_id INTO _owner FROM public.inventory WHERE id = _inv_id;
  IF _owner <> _uid THEN RAISE EXCEPTION 'not your item'; END IF;
  UPDATE public.inventory SET meta = _meta WHERE id = _inv_id;
END $$;
GRANT EXECUTE ON FUNCTION public.update_inventory_meta(uuid, jsonb) TO authenticated;

-- buy_ship_by_code (server-priced from ship_catalog)
CREATE OR REPLACE FUNCTION public.buy_ship_by_code(
  _code text, _template_id integer, _price_coins bigint, _max_hp integer
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _new uuid; _market_level int;
        _price bigint; _hp int; _required_market int; _tpl int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT sc.price_coins, sc.max_hp, sc.market_level_required, sc.sort_order
    INTO _price, _hp, _required_market, _tpl
  FROM public.ship_catalog sc WHERE sc.code = _code AND sc.active = true;
  IF _price IS NULL THEN RAISE EXCEPTION 'ship not found: %', _code; END IF;
  SELECT level INTO _market_level FROM public.user_market WHERE user_id = _uid;
  IF _market_level IS NULL THEN _market_level := 1; END IF;
  IF _required_market > _market_level THEN RAISE EXCEPTION 'market level too low'; END IF;
  IF (SELECT COUNT(*) FROM public.ships_owned WHERE user_id = _uid) >= 3 THEN
    RAISE EXCEPTION 'fleet full';
  END IF;
  PERFORM public._mutate_currency(_uid, -_price, 0, 0, 0);
  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp)
    VALUES (_uid, COALESCE(_tpl, _template_id), _code, false, _hp, _hp)
    RETURNING id INTO _new;
  RETURN _new;
END $$;
GRANT EXECUTE ON FUNCTION public.buy_ship_by_code(text, integer, bigint, integer) TO authenticated;

-- sell_ship: 50% refund of catalog price
CREATE OR REPLACE FUNCTION public.sell_ship(_ship_id uuid, _refund_coins bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid; _code text; _tpl int; _refund bigint := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT user_id, catalog_code, template_id INTO _owner, _code, _tpl
    FROM public.ships_owned WHERE id = _ship_id;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;
  SELECT FLOOR(price_coins * 0.5)::bigint INTO _refund
    FROM public.ship_catalog WHERE code = _code AND active = true LIMIT 1;
  IF _refund IS NULL THEN
    SELECT FLOOR(price_coins * 0.5)::bigint INTO _refund
      FROM public.ship_catalog WHERE sort_order = _tpl AND active = true LIMIT 1;
  END IF;
  IF _refund IS NULL THEN _refund := 0; END IF;
  DELETE FROM public.ships_owned WHERE id = _ship_id;
  IF _refund > 0 THEN PERFORM public._mutate_currency(_uid, _refund, 0, 0, 0); END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.sell_ship(uuid, bigint) TO authenticated;

-- Fishing with cooldown
ALTER TABLE public.ships_owned ADD COLUMN IF NOT EXISTS last_fishing_reward_at timestamptz;
ALTER TABLE public.ships_owned ADD COLUMN IF NOT EXISTS fishing_started_at timestamptz;

CREATE OR REPLACE FUNCTION public.award_fishing_revenue(_ship_id uuid, _coins bigint, _xp integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
        _owner uuid; _last timestamptz; _tpl int; _fish_secs int; _allow_coins bigint; _allow_xp int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _coins < 0 OR _xp < 0 THEN RAISE EXCEPTION 'bad args'; END IF;
  SELECT user_id, template_id, last_fishing_reward_at INTO _owner, _tpl, _last
  FROM public.ships_owned WHERE id = _ship_id FOR UPDATE;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;
  SELECT COALESCE(MIN(fishing_seconds), 60) INTO _fish_secs
    FROM public.ship_catalog WHERE sort_order = _tpl;
  IF _fish_secs IS NULL OR _fish_secs < 30 THEN _fish_secs := 30; END IF;
  IF _last IS NOT NULL AND now() < _last + make_interval(secs => _fish_secs) THEN
    RAISE EXCEPTION 'fishing cooldown';
  END IF;
  _allow_coins := LEAST(_coins, 5000 + (COALESCE(_tpl,1) * 4000)::bigint);
  _allow_xp    := LEAST(_xp, 50 + COALESCE(_tpl,1) * 40);
  UPDATE public.ships_owned SET last_fishing_reward_at = now() WHERE id = _ship_id;
  PERFORM public._mutate_currency(_uid, _allow_coins, 0, 0, _allow_xp);
END $$;
GRANT EXECUTE ON FUNCTION public.award_fishing_revenue(uuid, bigint, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.award_fishing_revenue_simple(_coins bigint, _xp integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'deprecated: use award_fishing_revenue(_ship_id, _coins, _xp)';
END $$;
REVOKE EXECUTE ON FUNCTION public.award_fishing_revenue_simple(bigint, integer) FROM anon, authenticated;

-- Profile updates: cosmetic columns only
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (display_name, avatar_url, avatar_emoji, selected_bg_id,
              avatar_frame, name_frame, online_at) ON public.profiles TO authenticated;

REVOKE UPDATE ON public.ships_owned FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.quest_progress FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_achievements FROM anon, authenticated;
REVOKE INSERT ON public.attacks FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_attack(
  _defender_id uuid, _target_ship_id uuid, _damage integer,
  _damage_dealt integer, _attacker_won boolean
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;
  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.record_attack(uuid, uuid, integer, integer, boolean) TO authenticated;

DROP POLICY IF EXISTS ub_select_any ON public.user_blocks;
DROP POLICY IF EXISTS ub_select_involved ON public.user_blocks;
CREATE POLICY ub_select_involved ON public.user_blocks FOR SELECT TO authenticated
  USING (auth.uid() = blocker_id OR auth.uid() = blocked_id);

DROP POLICY IF EXISTS friends_update_addressee ON public.friends;
CREATE POLICY friends_update_addressee ON public.friends FOR UPDATE
  USING (auth.uid() = addressee_id) WITH CHECK (auth.uid() = addressee_id);

REVOKE UPDATE ON public.tribe_wars FROM anon, authenticated;
GRANT UPDATE (status, ended_at) ON public.tribe_wars TO authenticated;

CREATE OR REPLACE FUNCTION public.set_ship_at_sea(_ship_id uuid, _at_sea boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT user_id INTO _owner FROM public.ships_owned WHERE id = _ship_id;
  IF _owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;
  UPDATE public.ships_owned
    SET at_sea = _at_sea,
        fishing_started_at = CASE
          WHEN _at_sea AND fishing_started_at IS NULL THEN now()
          WHEN NOT _at_sea THEN NULL
          ELSE fishing_started_at
        END
  WHERE id = _ship_id;
END $$;