
-- ============================================================
-- 1) Authoritative price catalog for client-defined items
-- ============================================================
CREATE TABLE IF NOT EXISTS public.client_item_prices (
  item_type text NOT NULL,
  item_id   text NOT NULL,
  price_coins bigint NOT NULL DEFAULT 0,
  price_gems  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (item_type, item_id)
);
ALTER TABLE public.client_item_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cip_all_view ON public.client_item_prices;
CREATE POLICY cip_all_view ON public.client_item_prices FOR SELECT USING (true);
DROP POLICY IF EXISTS cip_admin_manage ON public.client_item_prices;
CREATE POLICY cip_admin_manage ON public.client_item_prices FOR ALL
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- Seed prices for client-defined catalogs (frames, weapons, crews, backgrounds)
INSERT INTO public.client_item_prices(item_type,item_id,price_coins,price_gems) VALUES
  -- Avatar frames (gems)
  ('frame','af_bronze',0,500),('frame','af_silver',0,2000),('frame','af_gold',0,6000),
  ('frame','af_emerald',0,9000),('frame','af_ruby',0,18000),('frame','af_diamond',0,45000),
  ('frame','af_dragon',0,90000),('frame','af_phoenix',0,120000),('frame','af_imperial',0,200000),
  -- Name frames (gems)
  ('frame','nf_simple',0,300),('frame','nf_sky',0,1500),('frame','nf_gold',0,5000),
  ('frame','nf_emerald',0,8000),('frame','nf_royal',0,22000),('frame','nf_legend',0,60000),
  ('frame','nf_inferno',0,80000),('frame','nf_abyss',0,100000),
  ('name_frame','nf_simple',0,300),('name_frame','nf_sky',0,1500),('name_frame','nf_gold',0,5000),
  ('name_frame','nf_emerald',0,8000),('name_frame','nf_royal',0,22000),('name_frame','nf_legend',0,60000),
  ('name_frame','nf_inferno',0,80000),('name_frame','nf_abyss',0,100000),
  -- Weapons
  ('weapon','rocket_small',1500,0),('weapon','rocket_medium',15000,0),
  ('weapon','rocket_large',90000,0),('weapon','nuke',0,2500),
  -- Crews
  ('crew','luck',8000,0),('crew','guide',5000,0),('crew','thief',0,300),
  ('crew','sailor',3000,0),('crew','trader',0,250),('crew','police',0,200),
  ('crew','fixer_1',4000,0),('crew','fixer_2',15000,0),('crew','fixer_3',0,500),
  -- Backgrounds (coins)
  ('background','harbor',0,0),('background','sunset',25000,0),('background','tropical',60000,0),
  ('background','arctic',150000,0),('background','night',280000,0),
  ('background','cursed',500000,0),('background','volcano',1200000,0),('background','royal',3500000,0)
ON CONFLICT (item_type,item_id) DO UPDATE
  SET price_coins = EXCLUDED.price_coins, price_gems = EXCLUDED.price_gems;

-- ============================================================
-- 2) Replace buy_with_coins / buy_with_gems with server-priced versions
--    (signature unchanged; client-supplied cost is ignored)
-- ============================================================
CREATE OR REPLACE FUNCTION public.buy_with_coins(
  _item_id text, _item_type text, _coins_cost bigint, _meta jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  PERFORM public._mutate_currency(_uid, -_price, 0, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, 1, _meta)
    ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.buy_with_gems(
  _item_id text, _item_type text, _gems_cost integer, _meta jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  PERFORM public._mutate_currency(_uid, 0, -_price, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, 1, _meta)
    ON CONFLICT DO NOTHING;
END $$;

-- ============================================================
-- 3) buy_ship_by_code: look up price + max_hp from ship_catalog
-- ============================================================
CREATE OR REPLACE FUNCTION public.buy_ship_by_code(
  _code text, _template_id integer, _price_coins bigint, _max_hp integer
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
        _new uuid;
        _market_level int;
        _price bigint;
        _hp int;
        _required_market int;
        _tpl int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT sc.price_coins, sc.max_hp, sc.market_level_required, sc.sort_order
    INTO _price, _hp, _required_market, _tpl
  FROM public.ship_catalog sc
  WHERE sc.code = _code AND sc.active = true;
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

-- ============================================================
-- 4) sell_ship: refund is 50% of catalog price (server-computed)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sell_ship(_ship_id uuid, _refund_coins bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
        _owner uuid; _code text; _tpl int; _refund bigint := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT user_id, catalog_code, template_id INTO _owner, _code, _tpl
    FROM public.ships_owned WHERE id = _ship_id;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;

  -- Compute refund from catalog (50%). Prefer code match, then sort_order.
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

-- ============================================================
-- 5) Fishing: enforce ship cooldown server-side, disable _simple variant
-- ============================================================
ALTER TABLE public.ships_owned
  ADD COLUMN IF NOT EXISTS last_fishing_reward_at timestamptz;

CREATE OR REPLACE FUNCTION public.award_fishing_revenue(
  _ship_id uuid, _coins bigint, _xp integer
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid();
        _owner uuid; _last timestamptz; _tpl int; _fish_secs int; _allow_coins bigint; _allow_xp int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _coins < 0 OR _xp < 0 THEN RAISE EXCEPTION 'bad args'; END IF;

  SELECT user_id, template_id, last_fishing_reward_at
    INTO _owner, _tpl, _last
  FROM public.ships_owned WHERE id = _ship_id FOR UPDATE;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;

  SELECT COALESCE(MIN(fishing_seconds), 60) INTO _fish_secs
    FROM public.ship_catalog WHERE sort_order = _tpl;
  IF _fish_secs IS NULL OR _fish_secs < 30 THEN _fish_secs := 30; END IF;

  IF _last IS NOT NULL AND now() < _last + make_interval(secs => _fish_secs) THEN
    RAISE EXCEPTION 'fishing cooldown';
  END IF;

  -- Hard caps scaled to ship level so a single payout cannot mint a fortune
  _allow_coins := LEAST(_coins, 5000 + (COALESCE(_tpl,1) * 4000)::bigint);
  _allow_xp    := LEAST(_xp, 50 + COALESCE(_tpl,1) * 40);

  UPDATE public.ships_owned SET last_fishing_reward_at = now() WHERE id = _ship_id;
  PERFORM public._mutate_currency(_uid, _allow_coins, 0, 0, _allow_xp);
END $$;

-- Disable the unbounded simple variant; keep the function for type compat but always reject.
CREATE OR REPLACE FUNCTION public.award_fishing_revenue_simple(_coins bigint, _xp integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'deprecated: use award_fishing_revenue(_ship_id, _coins, _xp)';
END $$;
REVOKE EXECUTE ON FUNCTION public.award_fishing_revenue_simple(bigint, integer) FROM anon, authenticated;

-- ============================================================
-- 6) Lock down direct profile writes to cosmetic-only columns
-- ============================================================
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (
  display_name, avatar_url, avatar_emoji, selected_bg_id,
  avatar_frame, name_frame, online_at
) ON public.profiles TO authenticated;

-- ============================================================
-- 7) Lock down ships_owned direct updates (only at_sea via RPC, but block all direct UPDATE)
-- ============================================================
REVOKE UPDATE ON public.ships_owned FROM anon, authenticated;
-- (set_ship_at_sea is SECURITY DEFINER and continues to work)

-- ============================================================
-- 8) quest_progress / user_achievements: prevent direct INSERT/UPDATE/DELETE
-- ============================================================
REVOKE INSERT, UPDATE, DELETE ON public.quest_progress FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_achievements FROM anon, authenticated;
-- SELECT remains via existing RLS; SECURITY DEFINER RPCs (claim_quest, etc.) still mutate.

-- ============================================================
-- 9) Attacks: replace direct INSERT with record_attack RPC
-- ============================================================
REVOKE INSERT ON public.attacks FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_attack(
  _defender_id uuid, _target_ship_id uuid, _damage integer,
  _damage_dealt integer, _attacker_won boolean
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

-- ============================================================
-- 10) user_blocks: restrict SELECT to rows involving the user
-- ============================================================
DROP POLICY IF EXISTS ub_select_any ON public.user_blocks;
CREATE POLICY ub_select_involved ON public.user_blocks FOR SELECT TO authenticated
  USING (auth.uid() = blocker_id OR auth.uid() = blocked_id);

-- ============================================================
-- 11) friends: restrict status changes to addressee
-- ============================================================
DROP POLICY IF EXISTS friends_update_addressee ON public.friends;
CREATE POLICY friends_update_addressee ON public.friends FOR UPDATE
  USING (auth.uid() = addressee_id)
  WITH CHECK (auth.uid() = addressee_id);

-- ============================================================
-- 12) tribe_wars: restrict UPDATE to status / ended_at columns
-- ============================================================
REVOKE UPDATE ON public.tribe_wars FROM anon, authenticated;
GRANT UPDATE (status, ended_at) ON public.tribe_wars TO authenticated;

-- ============================================================
-- 13) Realtime channel authorization: require auth to subscribe
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='realtime' AND table_name='messages') THEN
    EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS realtime_authenticated_only ON realtime.messages';
    EXECUTE 'CREATE POLICY realtime_authenticated_only ON realtime.messages FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;
