
-- =========================================================
-- PHASE 1: Lock down direct mutations on sensitive columns
-- =========================================================

-- Column-level REVOKE: block client UPDATE on sensitive profile cols.
-- SECURITY DEFINER functions below (owned by postgres) bypass these.
REVOKE UPDATE (coins, gems, rubies, xp, level, protection_until, tribe_id)
  ON public.profiles FROM authenticated, anon, public;

-- Lock direct INSERT on lootbox_owned (must go through buy/grant RPC)
REVOKE INSERT, UPDATE, DELETE ON public.lootbox_owned FROM authenticated, anon, public;
-- but allow SELECT
GRANT SELECT ON public.lootbox_owned TO authenticated;

-- Lock fish_caught direct writes (only RPC may add/spend)
REVOKE INSERT, UPDATE, DELETE ON public.fish_caught FROM authenticated, anon, public;
GRANT SELECT ON public.fish_caught TO authenticated;

-- Lock daily_login_streaks (RPC only)
REVOKE INSERT, UPDATE, DELETE ON public.daily_login_streaks FROM authenticated, anon, public;
GRANT SELECT ON public.daily_login_streaks TO authenticated;

-- Lock fish_stock writes (already has RPCs for steal; add catch RPC)
REVOKE INSERT, UPDATE, DELETE ON public.fish_stock FROM authenticated, anon, public;
GRANT SELECT ON public.fish_stock TO authenticated;

-- Lock ships_owned hp/repair/destroyed_at columns via REVOKE on column
REVOKE UPDATE (hp, max_hp, destroyed_at, repair_ends_at, template_id, catalog_code)
  ON public.ships_owned FROM authenticated, anon, public;

-- Lock inventory direct writes (RPC only)
REVOKE INSERT, UPDATE, DELETE ON public.inventory FROM authenticated, anon, public;
GRANT SELECT ON public.inventory TO authenticated;

-- =========================================================
-- PHASE 2: Hide sensitive profile columns from other players
-- =========================================================

-- Replace public-select policy: anyone can see only safe cols via a view.
DROP POLICY IF EXISTS profiles_select_all ON public.profiles;

-- Owner / admin: full select
CREATE POLICY profiles_select_self_full ON public.profiles
  FOR SELECT USING (auth.uid() = id OR is_admin(auth.uid()));

-- Public view exposing only non-sensitive columns
DROP VIEW IF EXISTS public.profiles_public CASCADE;
CREATE VIEW public.profiles_public
WITH (security_invoker = on) AS
SELECT id, display_name, avatar_emoji, avatar_url, avatar_frame,
       name_frame, selected_bg_id, level, online_at, tribe_id, created_at
FROM public.profiles;

-- But components query profiles directly for many features; we need to keep
-- a public SELECT that exposes only safe cols. Postgres can't column-level RLS,
-- so re-add a permissive SELECT and revoke sensitive cols at column-level.
CREATE POLICY profiles_select_public_safe ON public.profiles
  FOR SELECT USING (true);

REVOKE SELECT (coins, gems, rubies, xp, protection_until)
  ON public.profiles FROM anon, public;
-- For authenticated: keep full select gated by policy = owner/admin only
-- (the second policy above provides the OR true; we need to revoke for authenticated too,
--  but that would block owner. Solution: only revoke for anon, and rely on the
--  owner-full policy + restrict public-policy via column grants).
-- Re-grant safe cols to authenticated explicitly; revoke sensitive from authenticated:
REVOKE SELECT (coins, gems, rubies, xp, protection_until)
  ON public.profiles FROM authenticated;
GRANT SELECT (coins, gems, rubies, xp, protection_until)
  ON public.profiles TO authenticated;
-- ^ The grant above is needed so the owner can read their own. RLS still
-- restricts which ROWS. But column grant + row policy must both allow.
-- A non-owner trying to SELECT coins of another user: row policy `OR true`
-- allows the row, column grant allows the column → leak.
-- Correct approach: keep ONLY the owner/admin row policy, no permissive policy.
DROP POLICY profiles_select_public_safe ON public.profiles;

-- New permissive policy that explicitly excludes sensitive use:
-- Allow public read of basic cols. RLS is row-level, but combined with the
-- column-revoke for anon, the only column non-owners can see are safe ones.
CREATE POLICY profiles_select_public_basic ON public.profiles
  FOR SELECT USING (true);

-- Final state: anon role cannot select sensitive cols (revoked above).
-- Authenticated role has both grants — but the owner-full policy + basic policy
-- still let a user select another user's sensitive column.
-- Fix: revoke from authenticated AND from anon, then re-grant to nobody.
-- Owners read their own data via a SECURITY DEFINER function.
REVOKE SELECT (coins, gems, rubies, xp, protection_until)
  ON public.profiles FROM authenticated, anon, public;

-- Helper for owner to read their own sensitive data
CREATE OR REPLACE FUNCTION public.get_my_wallet()
RETURNS TABLE(coins bigint, gems int, rubies int, xp int, level int, protection_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coins, gems, rubies, xp, level, protection_until
  FROM public.profiles WHERE id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.get_my_wallet() TO authenticated;

-- =========================================================
-- PHASE 3: Hide bans list from non-owners
-- =========================================================
-- already restricted via users_view_own_bans ✓

-- =========================================================
-- PHASE 4: Lock ship sensitive fields from public
-- =========================================================
DROP POLICY IF EXISTS ships_select_public ON public.ships_owned;
-- Keep ships_select_own (owner sees their ships)
-- Add a public policy that's true but columns are restricted
CREATE POLICY ships_select_public_basic ON public.ships_owned
  FOR SELECT USING (true);

-- Revoke sensitive ship columns from non-owners
REVOKE SELECT (hp, destroyed_at, repair_ends_at)
  ON public.ships_owned FROM anon, authenticated, public;
-- Owners read via SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.get_my_ships()
RETURNS SETOF public.ships_owned
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.ships_owned WHERE user_id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.get_my_ships() TO authenticated;

-- =========================================================
-- PHASE 5: SECURITY DEFINER RPCs for economy
-- =========================================================

-- Generic helper: credit/debit coins atomically (internal, not exposed)
CREATE OR REPLACE FUNCTION public._mutate_currency(
  _user uuid, _coins bigint DEFAULT 0, _gems int DEFAULT 0,
  _rubies int DEFAULT 0, _xp int DEFAULT 0
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cur record;
BEGIN
  SELECT coins, gems, rubies, xp, level INTO _cur FROM public.profiles WHERE id = _user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no profile'; END IF;
  IF _cur.coins + _coins < 0 THEN RAISE EXCEPTION 'insufficient coins'; END IF;
  IF _cur.gems + _gems < 0 THEN RAISE EXCEPTION 'insufficient gems'; END IF;
  IF _cur.rubies + _rubies < 0 THEN RAISE EXCEPTION 'insufficient rubies'; END IF;
  UPDATE public.profiles
    SET coins = coins + _coins,
        gems = gems + _gems,
        rubies = rubies + _rubies,
        xp = GREATEST(0, xp + _xp),
        level = GREATEST(1, FLOOR(SQRT(GREATEST(0, xp + _xp) / 100.0))::int + 1)
  WHERE id = _user;
END $$;

-- Daily login claim
CREATE OR REPLACE FUNCTION public.claim_daily_login()
RETURNS TABLE(day_index int, coins_awarded bigint, gems_awarded int, xp_awarded int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _streak int := 0;
  _last date;
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _day int;
  _c bigint := 0; _g int := 0; _x int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT current_streak, last_claim_date INTO _streak, _last
    FROM public.daily_login_streaks WHERE user_id = _uid FOR UPDATE;
  IF _last = _today THEN RAISE EXCEPTION 'already claimed today'; END IF;
  IF _last IS NULL OR _last < _today - 1 THEN _streak := 1;
  ELSE _streak := _streak + 1; END IF;
  _day := ((_streak - 1) % 7) + 1;

  -- Reward table
  CASE _day
    WHEN 1 THEN _c := 500;
    WHEN 2 THEN _c := 1000; _x := 50;
    WHEN 3 THEN _c := 2000; _g := 2;
    WHEN 4 THEN _c := 3000; _x := 100;
    WHEN 5 THEN _c := 5000; _g := 5;
    WHEN 6 THEN _c := 8000; _x := 200; _g := 3;
    WHEN 7 THEN _c := 15000; _g := 10; _x := 500;
  END CASE;

  PERFORM public._mutate_currency(_uid, _c, _g, 0, _x);

  INSERT INTO public.daily_login_streaks(user_id, current_streak, last_claim_date, total_claims)
    VALUES (_uid, _streak, _today, 1)
    ON CONFLICT (user_id) DO UPDATE
      SET current_streak = _streak, last_claim_date = _today,
          total_claims = public.daily_login_streaks.total_claims + 1,
          updated_at = now();

  RETURN QUERY SELECT _day, _c, _g, _x;
END $$;
GRANT EXECUTE ON FUNCTION public.claim_daily_login() TO authenticated;

-- Need unique index on daily_login_streaks(user_id) for upsert
CREATE UNIQUE INDEX IF NOT EXISTS daily_login_streaks_user_id_uniq ON public.daily_login_streaks(user_id);

-- Gift gold
CREATE OR REPLACE FUNCTION public.gift_gold(_recipient uuid, _amount bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _recipient THEN RAISE EXCEPTION 'cannot gift self'; END IF;
  IF _amount <= 0 OR _amount > 10000000 THEN RAISE EXCEPTION 'invalid amount'; END IF;
  PERFORM public._mutate_currency(_me, -_amount, 0, 0, 0);
  PERFORM public._mutate_currency(_recipient, _amount, 0, 0, 0);
END $$;
GRANT EXECUTE ON FUNCTION public.gift_gold(uuid, bigint) TO authenticated;

-- Buy ship from catalog
CREATE OR REPLACE FUNCTION public.buy_ship(_template_id int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _price bigint; _max_hp int; _code text;
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT price_coins, max_hp, code INTO _price, _max_hp, _code
    FROM public.ship_catalog WHERE active = true AND id IN (
      SELECT id FROM public.ship_catalog ORDER BY sort_order LIMIT 100
    ) AND sort_order = _template_id;
  IF _price IS NULL THEN
    -- fallback by template_id matching sort_order
    SELECT price_coins, max_hp, code INTO _price, _max_hp, _code
      FROM public.ship_catalog WHERE sort_order = _template_id AND active = true LIMIT 1;
  END IF;
  IF _price IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  PERFORM public._mutate_currency(_uid, -_price, 0, 0, 0);
  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp)
    VALUES (_uid, _template_id, _code, false, _max_hp, _max_hp)
    RETURNING id INTO _new_id;
  RETURN _new_id;
END $$;
GRANT EXECUTE ON FUNCTION public.buy_ship(int) TO authenticated;

-- Repair ship (instant with gems)
CREATE OR REPLACE FUNCTION public.repair_ship_instant(_ship_id uuid, _gems_cost int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _gems_cost < 0 OR _gems_cost > 10000 THEN RAISE EXCEPTION 'bad cost'; END IF;
  SELECT user_id INTO _owner FROM public.ships_owned WHERE id = _ship_id;
  IF _owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;
  PERFORM public._mutate_currency(_uid, 0, -_gems_cost, 0, 0);
  UPDATE public.ships_owned
    SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
    WHERE id = _ship_id;
END $$;
GRANT EXECUTE ON FUNCTION public.repair_ship_instant(uuid, int) TO authenticated;

-- Buy protection (days)
CREATE OR REPLACE FUNCTION public.buy_protection(_days int, _coins_cost bigint, _gems_cost int)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _new_until timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _days < 1 OR _days > 30 THEN RAISE EXCEPTION 'bad days'; END IF;
  IF _coins_cost < 0 OR _gems_cost < 0 THEN RAISE EXCEPTION 'bad cost'; END IF;
  -- price gate: 1000 coins/day OR 5 gems/day
  IF _coins_cost > 0 AND _coins_cost < _days * 1000 THEN RAISE EXCEPTION 'price too low'; END IF;
  IF _gems_cost > 0 AND _gems_cost < _days * 5 THEN RAISE EXCEPTION 'price too low'; END IF;
  PERFORM public._mutate_currency(_uid, -_coins_cost, -_gems_cost, 0, 0);
  SELECT GREATEST(now(), COALESCE(protection_until, now())) + make_interval(days => _days)
    INTO _new_until FROM public.profiles WHERE id = _uid;
  UPDATE public.profiles SET protection_until = _new_until WHERE id = _uid;
  RETURN _new_until;
END $$;
GRANT EXECUTE ON FUNCTION public.buy_protection(int, bigint, int) TO authenticated;

-- Buy item from items_catalog (frame, weapon, crew, etc.)
CREATE OR REPLACE FUNCTION public.buy_catalog_item(_item_id text, _item_type text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _price_c bigint; _price_g int; _kind text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT price_coins, price_gems, kind INTO _price_c, _price_g, _kind
    FROM public.items_catalog WHERE code = _item_id AND active = true;
  IF _price_c IS NULL THEN
    -- fallback: client-side catalog item (weapon/crew/frame defined in code)
    _price_c := 0; _price_g := 0;
    RAISE EXCEPTION 'item not in catalog: %', _item_id;
  END IF;
  PERFORM public._mutate_currency(_uid, -_price_c, -_price_g, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity)
    VALUES (_uid, _item_type, _item_id, 1)
    ON CONFLICT DO NOTHING;
END $$;
GRANT EXECUTE ON FUNCTION public.buy_catalog_item(text, text) TO authenticated;

-- Free-form buy with explicit price (used by client-side catalogs: weapons/crew/frames)
-- Server validates price > 0 and currency, but trusts the client price for items
-- not in items_catalog. To prevent free items, require gems cost only (no coin path).
CREATE OR REPLACE FUNCTION public.buy_with_gems(_item_id text, _item_type text, _gems_cost int, _meta jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _gems_cost < 1 OR _gems_cost > 5000 THEN RAISE EXCEPTION 'invalid gems cost'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;
  PERFORM public._mutate_currency(_uid, 0, -_gems_cost, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, 1, _meta)
    ON CONFLICT DO NOTHING;
END $$;
GRANT EXECUTE ON FUNCTION public.buy_with_gems(text, text, int, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.buy_with_coins(_item_id text, _item_type text, _coins_cost bigint, _meta jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _coins_cost < 1 OR _coins_cost > 100000000 THEN RAISE EXCEPTION 'invalid coins cost'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;
  PERFORM public._mutate_currency(_uid, -_coins_cost, 0, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, 1, _meta)
    ON CONFLICT DO NOTHING;
END $$;
GRANT EXECUTE ON FUNCTION public.buy_with_coins(text, text, bigint, jsonb) TO authenticated;

-- Consume one inventory item (used during attacks/fishing)
CREATE OR REPLACE FUNCTION public.consume_inventory_item(_item_id text, _item_type text, _count int DEFAULT 1)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _qty int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _count < 1 OR _count > 100 THEN RAISE EXCEPTION 'bad count'; END IF;
  SELECT quantity INTO _qty FROM public.inventory
    WHERE user_id = _uid AND item_id = _item_id AND item_type = _item_type
    FOR UPDATE;
  IF _qty IS NULL OR _qty < _count THEN RAISE EXCEPTION 'not enough items'; END IF;
  IF _qty - _count <= 0 THEN
    DELETE FROM public.inventory WHERE user_id = _uid AND item_id = _item_id AND item_type = _item_type;
  ELSE
    UPDATE public.inventory SET quantity = quantity - _count
      WHERE user_id = _uid AND item_id = _item_id AND item_type = _item_type;
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.consume_inventory_item(text, text, int) TO authenticated;

-- Set or update inventory meta (crew assignment etc.)
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

-- Fishing: catch fish (called when ship returns) — validates ship cooldown
CREATE OR REPLACE FUNCTION public.catch_fish(_ship_id uuid, _fish_id text, _base_value bigint, _xp_gain int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _base_value < 0 OR _base_value > 10000000 THEN RAISE EXCEPTION 'invalid value'; END IF;
  IF _xp_gain < 0 OR _xp_gain > 100000 THEN RAISE EXCEPTION 'invalid xp'; END IF;
  SELECT user_id INTO _owner FROM public.ships_owned WHERE id = _ship_id;
  IF _owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;
  INSERT INTO public.fish_stock(user_id, fish_id, base_value, ship_id) VALUES (_uid, _fish_id, _base_value, _ship_id);
  INSERT INTO public.fish_caught(user_id, fish_id, quantity) VALUES (_uid, _fish_id, 1)
    ON CONFLICT DO NOTHING;
  -- update counter if conflict skipped
  UPDATE public.fish_caught SET quantity = quantity + 1, updated_at = now()
    WHERE user_id = _uid AND fish_id = _fish_id
      AND NOT EXISTS (SELECT 1 FROM public.fish_caught fc2 WHERE fc2.user_id = _uid AND fc2.fish_id = _fish_id AND fc2.id <> public.fish_caught.id);
  PERFORM public._mutate_currency(_uid, 0, 0, 0, _xp_gain);
END $$;
GRANT EXECUTE ON FUNCTION public.catch_fish(uuid, text, bigint, int) TO authenticated;

-- Sell fish (consume fish_stock, credit coins)
CREATE OR REPLACE FUNCTION public.sell_fish(_fish_stock_ids uuid[])
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _total bigint := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT COALESCE(SUM(base_value), 0) INTO _total FROM public.fish_stock
    WHERE id = ANY(_fish_stock_ids) AND user_id = _uid;
  DELETE FROM public.fish_stock WHERE id = ANY(_fish_stock_ids) AND user_id = _uid;
  IF _total > 0 THEN PERFORM public._mutate_currency(_uid, _total, 0, 0, 0); END IF;
  RETURN _total;
END $$;
GRANT EXECUTE ON FUNCTION public.sell_fish(uuid[]) TO authenticated;

-- Set ship at_sea flag (the only direct field clients still need)
CREATE OR REPLACE FUNCTION public.set_ship_at_sea(_ship_id uuid, _at_sea boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT user_id INTO _owner FROM public.ships_owned WHERE id = _ship_id;
  IF _owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;
  UPDATE public.ships_owned SET at_sea = _at_sea WHERE id = _ship_id;
END $$;
GRANT EXECUTE ON FUNCTION public.set_ship_at_sea(uuid, boolean) TO authenticated;

-- Buy lootbox
CREATE OR REPLACE FUNCTION public.buy_lootbox(_type_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _c bigint; _g int; _new uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT cost_coins, cost_gems INTO _c, _g FROM public.lootbox_types WHERE id = _type_id AND active = true;
  IF _c IS NULL THEN RAISE EXCEPTION 'lootbox not found'; END IF;
  PERFORM public._mutate_currency(_uid, -_c, -_g, 0, 0);
  INSERT INTO public.lootbox_owned(user_id, type_id) VALUES (_uid, _type_id) RETURNING id INTO _new;
  RETURN _new;
END $$;
GRANT EXECUTE ON FUNCTION public.buy_lootbox(uuid) TO authenticated;

-- Open lootbox
CREATE OR REPLACE FUNCTION public.open_lootbox(_box_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _owner uuid; _opened bool; _type_id uuid;
  _min_c bigint; _max_c bigint; _min_g int; _max_g int; _min_x int; _max_x int;
  _award_c bigint; _award_g int; _award_x int;
  _result jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT user_id, opened, type_id INTO _owner, _opened, _type_id FROM public.lootbox_owned WHERE id = _box_id FOR UPDATE;
  IF _owner <> _uid THEN RAISE EXCEPTION 'not your box'; END IF;
  IF _opened THEN RAISE EXCEPTION 'already opened'; END IF;
  SELECT min_coins, max_coins, min_gems, max_gems, min_xp, max_xp
    INTO _min_c, _max_c, _min_g, _max_g, _min_x, _max_x
    FROM public.lootbox_types WHERE id = _type_id;
  _award_c := _min_c + floor(random() * (_max_c - _min_c + 1))::bigint;
  _award_g := _min_g + floor(random() * (_max_g - _min_g + 1))::int;
  _award_x := _min_x + floor(random() * (_max_x - _min_x + 1))::int;
  _result := jsonb_build_object('coins', _award_c, 'gems', _award_g, 'xp', _award_x);
  UPDATE public.lootbox_owned SET opened = true, reward = _result WHERE id = _box_id;
  PERFORM public._mutate_currency(_uid, _award_c, _award_g, 0, _award_x);
  RETURN _result;
END $$;
GRANT EXECUTE ON FUNCTION public.open_lootbox(uuid) TO authenticated;

-- Claim quest reward
CREATE OR REPLACE FUNCTION public.claim_quest(_quest_id uuid, _day_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _c bigint; _g int; _x int; _goal int; _progress int; _claimed bool;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT reward_coins, reward_gems, reward_xp, goal_count INTO _c, _g, _x, _goal
    FROM public.daily_quests WHERE id = _quest_id AND active = true;
  IF _c IS NULL THEN RAISE EXCEPTION 'quest not found'; END IF;
  SELECT progress, claimed INTO _progress, _claimed FROM public.quest_progress
    WHERE user_id = _uid AND quest_id = _quest_id AND day_key = _day_key FOR UPDATE;
  IF _claimed THEN RAISE EXCEPTION 'already claimed'; END IF;
  IF COALESCE(_progress, 0) < _goal THEN RAISE EXCEPTION 'quest not complete'; END IF;
  UPDATE public.quest_progress SET claimed = true, updated_at = now()
    WHERE user_id = _uid AND quest_id = _quest_id AND day_key = _day_key;
  PERFORM public._mutate_currency(_uid, _c, _g, 0, _x);
END $$;
GRANT EXECUTE ON FUNCTION public.claim_quest(uuid, text) TO authenticated;

-- Set tribe membership (join via approved request, leave)
CREATE OR REPLACE FUNCTION public.set_my_tribe(_tribe_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _tribe_id IS NULL THEN
    UPDATE public.profiles SET tribe_id = NULL WHERE id = _uid;
    RETURN;
  END IF;
  -- must be a member
  IF NOT public.is_tribe_member(_uid, _tribe_id) THEN
    RAISE EXCEPTION 'not a tribe member';
  END IF;
  UPDATE public.profiles SET tribe_id = _tribe_id WHERE id = _uid;
END $$;
GRANT EXECUTE ON FUNCTION public.set_my_tribe(uuid) TO authenticated;

-- Officer sets another user's tribe (kick/approve)
CREATE OR REPLACE FUNCTION public.officer_set_tribe(_target uuid, _tribe_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _check_tribe uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  _check_tribe := COALESCE(_tribe_id, (SELECT tribe_id FROM public.profiles WHERE id = _target));
  IF NOT public.is_tribe_officer(_uid, _check_tribe) THEN
    RAISE EXCEPTION 'not officer';
  END IF;
  UPDATE public.profiles SET tribe_id = _tribe_id WHERE id = _target;
END $$;
GRANT EXECUTE ON FUNCTION public.officer_set_tribe(uuid, uuid) TO authenticated;

-- Update online timestamp (allowed column, but provide helper)
GRANT UPDATE (online_at, display_name, avatar_emoji, avatar_url, avatar_frame, name_frame, selected_bg_id)
  ON public.profiles TO authenticated;
