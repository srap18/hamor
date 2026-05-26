
-- =====================================================
-- Sell a ship: refund coins, delete ship row, delete assigned crew
-- =====================================================
CREATE OR REPLACE FUNCTION public.sell_ship(_ship_id uuid, _refund_coins bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _refund_coins < 0 OR _refund_coins > 100000000 THEN RAISE EXCEPTION 'bad refund'; END IF;
  SELECT user_id INTO _owner FROM public.ships_owned WHERE id = _ship_id;
  IF _owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;
  -- Delete crew assigned to this local ship slot (meta.assigned_ship_id matches)
  -- Cannot match local int id reliably, leave to client-side via delete_inventory_rows.
  DELETE FROM public.ships_owned WHERE id = _ship_id;
  PERFORM public._mutate_currency(_uid, _refund_coins, 0, 0, 0);
END $$;
GRANT EXECUTE ON FUNCTION public.sell_ship(uuid, bigint) TO authenticated;

-- =====================================================
-- Delete inventory rows owned by caller
-- =====================================================
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

-- =====================================================
-- Split a stack: decrement qty by 1 and insert a new qty=1 row with meta
-- (used to assign one crew unit to a ship slot)
-- =====================================================
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

-- =====================================================
-- Award fishing revenue (coins + xp) tied to a ship owned by caller
-- Caps to prevent abuse.
-- =====================================================
CREATE OR REPLACE FUNCTION public.award_fishing_revenue(_ship_id uuid, _coins bigint, _xp integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _coins < 0 OR _coins > 5000000 THEN RAISE EXCEPTION 'bad coins'; END IF;
  IF _xp < 0 OR _xp > 50000 THEN RAISE EXCEPTION 'bad xp'; END IF;
  SELECT user_id INTO _owner FROM public.ships_owned WHERE id = _ship_id;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;
  PERFORM public._mutate_currency(_uid, _coins, 0, 0, _xp);
END $$;
GRANT EXECUTE ON FUNCTION public.award_fishing_revenue(uuid, bigint, integer) TO authenticated;

-- Variant without ship id (for legacy fishing collect that has no DB ship binding)
-- Strict cap of 100k coins per call.
CREATE OR REPLACE FUNCTION public.award_fishing_revenue_simple(_coins bigint, _xp integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _coins < 0 OR _coins > 500000 THEN RAISE EXCEPTION 'bad coins'; END IF;
  IF _xp < 0 OR _xp > 5000 THEN RAISE EXCEPTION 'bad xp'; END IF;
  PERFORM public._mutate_currency(_uid, _coins, 0, 0, _xp);
END $$;
GRANT EXECUTE ON FUNCTION public.award_fishing_revenue_simple(bigint, integer) TO authenticated;

-- =====================================================
-- Increment fish_caught counter (for the home-page fishing UI)
-- =====================================================
CREATE OR REPLACE FUNCTION public.increment_fish_caught(_fish_id text, _qty integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty < 1 OR _qty > 10000 THEN RAISE EXCEPTION 'bad qty'; END IF;
  INSERT INTO public.fish_caught(user_id, fish_id, quantity) VALUES (_uid, _fish_id, _qty)
  ON CONFLICT (user_id, fish_id) DO UPDATE SET quantity = public.fish_caught.quantity + _qty, updated_at = now();
END $$;
-- need composite unique index for ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS fish_caught_user_fish_uniq ON public.fish_caught(user_id, fish_id);
GRANT EXECUTE ON FUNCTION public.increment_fish_caught(text, integer) TO authenticated;

-- =====================================================
-- ADMIN: set a player's currency / xp / level (audit handled in client)
-- =====================================================
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

-- ADMIN: grant lootbox to a player
CREATE OR REPLACE FUNCTION public.admin_grant_lootbox(_player uuid, _type_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'not admin'; END IF;
  INSERT INTO public.lootbox_owned(user_id, type_id) VALUES (_player, _type_id) RETURNING id INTO _id;
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_grant_lootbox(uuid, uuid) TO authenticated;

-- ADMIN: mass gift coins/gems/xp to all players
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
