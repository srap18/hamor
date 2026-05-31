
-- Balance XP awards: small XP for fishing sales, moderate XP for explosions/attacks.
-- Level curve: level = floor(sqrt(xp/100)) + 1
--   L1→L2 needs 100 xp, L5→L6 needs ~500, L10→L11 ~1900, L20→L21 ~3900.

-- 1) Fishing: award XP when selling fish (per-coin earned).
--    Formula: xp = clamp(floor(coins_earned / 250), 1, 200) when earned > 0.
--    e.g. 2,500 coins = 10 xp, 50,000 coins = 200 xp (cap).
CREATE OR REPLACE FUNCTION public.sell_fish_caught(_fish_id text, _qty integer, _unit_price numeric)
RETURNS TABLE(remaining integer, coins_earned bigint, new_coins bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _have integer;
  _sell integer;
  _earned bigint;
  _new_coins bigint;
  _remaining integer;
  _xp_gain integer := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty <= 0 THEN RAISE EXCEPTION 'invalid qty'; END IF;
  IF _unit_price IS NULL OR _unit_price < 0 THEN RAISE EXCEPTION 'invalid price'; END IF;

  SELECT quantity INTO _have
  FROM public.fish_caught
  WHERE user_id = _uid AND fish_id = _fish_id
  FOR UPDATE;

  IF _have IS NULL OR _have <= 0 THEN
    RAISE EXCEPTION 'no fish to sell';
  END IF;

  _sell := LEAST(_qty, _have);
  _remaining := _have - _sell;
  _earned := (_sell::numeric * _unit_price)::bigint;

  IF _remaining > 0 THEN
    UPDATE public.fish_caught
      SET quantity = _remaining, updated_at = now()
      WHERE user_id = _uid AND fish_id = _fish_id;
  ELSE
    DELETE FROM public.fish_caught
      WHERE user_id = _uid AND fish_id = _fish_id;
  END IF;

  IF _earned > 0 THEN
    _xp_gain := LEAST(200, GREATEST(1, (_earned / 250)::int));
  END IF;

  UPDATE public.profiles
    SET coins = coins + _earned,
        xp = GREATEST(0, xp + _xp_gain),
        level = GREATEST(1, FLOOR(SQRT(GREATEST(0, xp + _xp_gain) / 100.0))::int + 1)
    WHERE id = _uid
    RETURNING coins INTO _new_coins;

  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
    VALUES (_uid, 'fish_sale', _earned, 'coins',
            jsonb_build_object('fish_id', _fish_id, 'qty', _sell, 'unit_price', _unit_price, 'xp', _xp_gain));

  remaining := _remaining;
  coins_earned := _earned;
  new_coins := _new_coins;
  RETURN NEXT;
END;
$$;

-- Bulk sell_fish also rewards XP based on total earned.
CREATE OR REPLACE FUNCTION public.sell_fish(_fish_stock_ids uuid[])
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _total bigint := 0;
  _xp_gain integer := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT COALESCE(SUM(base_value), 0) INTO _total FROM public.fish_stock
    WHERE id = ANY(_fish_stock_ids) AND user_id = _uid;
  DELETE FROM public.fish_stock WHERE id = ANY(_fish_stock_ids) AND user_id = _uid;
  IF _total > 0 THEN
    _xp_gain := LEAST(200, GREATEST(1, (_total / 250)::int));
    PERFORM public._mutate_currency(_uid, _total, 0, 0, _xp_gain);
  END IF;
  RETURN _total;
END
$$;

-- 2) Attacks: award XP based on damage actually dealt.
--    Formula: xp = clamp(floor(damage_dealt / 10), 1, 500) per ship hit.
--    rocket_small (120) → 12 xp, medium (500) → 50, large (1500) → 150,
--    nuke (70000) → 500 (cap) per ship, AOE on 3 ships ≈ 1500 xp total.
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner uuid;
  _tpl int;
  _repair_secs int;
  _resulting_hp int;
  _resulting_repair timestamptz;
  _prot timestamptz;
  _attacker uuid := auth.uid();
  _prev_hp int;
  _dmg_dealt int;
  _xp_gain int;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT s.user_id, s.template_id, COALESCE(s.hp, 100) INTO _owner, _tpl, _prev_hp
    FROM public.ships_owned s WHERE s.id = _ship_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = _attacker THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  IF NOT public.has_pvp_fleet(_attacker) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;

  IF NOT public.has_fishing_ship(_attacker) THEN
    RAISE EXCEPTION 'attacker needs fishing ship: send a ship to fish first';
  END IF;

  IF NOT public.is_market_pvp_unlocked(_owner) THEN
    RAISE EXCEPTION 'target is protected (market level under 6)';
  END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _owner;
  IF _prot IS NOT NULL AND _prot > now() THEN
    RAISE EXCEPTION 'target is protected';
  END IF;

  _tpl := COALESCE(_tpl, 1);
  _repair_secs := LEAST(259200, GREATEST(14400, _tpl * _tpl * 600));

  UPDATE public.ships_owned AS s
     SET hp = s.max_hp, destroyed_at = NULL, repair_ends_at = NULL
   WHERE s.id = _ship_id
     AND s.destroyed_at IS NOT NULL
     AND s.repair_ends_at IS NOT NULL
     AND s.repair_ends_at <= now();

  -- Re-read HP after auto-repair so XP reflects current state
  SELECT COALESCE(hp, 100) INTO _prev_hp FROM public.ships_owned WHERE id = _ship_id;

  UPDATE public.ships_owned AS s
    SET hp = GREATEST(0, COALESCE(s.hp, 100) - _damage),
        destroyed_at = CASE
          WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 AND s.destroyed_at IS NULL
          THEN now() ELSE s.destroyed_at END,
        repair_ends_at = CASE
          WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 AND s.repair_ends_at IS NULL
          THEN now() + make_interval(secs => _repair_secs) ELSE s.repair_ends_at END
  WHERE s.id = _ship_id
  RETURNING s.hp, s.repair_ends_at INTO _resulting_hp, _resulting_repair;

  _dmg_dealt := GREATEST(0, _prev_hp - COALESCE(_resulting_hp, 0));
  IF _dmg_dealt > 0 THEN
    _xp_gain := LEAST(500, GREATEST(1, _dmg_dealt / 10));
    PERFORM public._mutate_currency(_attacker, 0, 0, 0, _xp_gain);
  END IF;

  new_hp := _resulting_hp;
  destroyed := _resulting_hp = 0;
  repair_ends_at := _resulting_repair;
  RETURN NEXT;
END;
$$;
