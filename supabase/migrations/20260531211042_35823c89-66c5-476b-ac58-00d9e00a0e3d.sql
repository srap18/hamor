
-- 1) Keep fish_caught row when fully sold so total_caught (lifetime discovery) is preserved.
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

  -- Always UPDATE (never delete) so total_caught lifetime stays intact.
  UPDATE public.fish_caught
    SET quantity = _remaining, updated_at = now()
    WHERE user_id = _uid AND fish_id = _fish_id;

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

-- 2) Bulk sell_fish: same idea — track lifetime discoveries when selling from fish_stock.
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
  _sold_counts jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Aggregate sold-by-species so we record lifetime discoveries.
  SELECT COALESCE(jsonb_object_agg(fish_id, cnt), '{}'::jsonb)
    INTO _sold_counts
  FROM (
    SELECT fish_id, COUNT(*)::int AS cnt
      FROM public.fish_stock
     WHERE id = ANY(_fish_stock_ids) AND user_id = _uid
     GROUP BY fish_id
  ) s;

  SELECT COALESCE(SUM(base_value), 0) INTO _total FROM public.fish_stock
    WHERE id = ANY(_fish_stock_ids) AND user_id = _uid;
  DELETE FROM public.fish_stock WHERE id = ANY(_fish_stock_ids) AND user_id = _uid;

  -- Record lifetime discoveries in fish_caught (without bumping current quantity).
  IF _sold_counts IS NOT NULL AND _sold_counts <> '{}'::jsonb THEN
    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    SELECT _uid, key, 0, (value)::int
      FROM jsonb_each_text(_sold_counts)
    ON CONFLICT (user_id, fish_id)
    DO UPDATE SET total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
                  updated_at = now();
  END IF;

  IF _total > 0 THEN
    _xp_gain := LEAST(200, GREATEST(1, (_total / 250)::int));
    PERFORM public._mutate_currency(_uid, _total, 0, 0, _xp_gain);
  END IF;
  RETURN _total;
END
$$;

-- 3) Public leaderboard RPCs (SECURITY DEFINER so they bypass per-user RLS safely).

-- Fish discovery leaderboard: rank by unique species discovered, tie-break on lifetime total.
CREATE OR REPLACE FUNCTION public.get_fish_leaderboard(_limit integer DEFAULT 30)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  avatar_emoji text,
  avatar_url text,
  level integer,
  avatar_frame text,
  name_frame text,
  unique_fish integer,
  total_fish bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
         p.avatar_frame, p.name_frame,
         COALESCE(agg.unique_fish, 0)::int AS unique_fish,
         COALESCE(agg.total_fish, 0)::bigint AS total_fish
    FROM public.profiles p
    JOIN (
      SELECT fc.user_id,
             COUNT(*) FILTER (WHERE fc.total_caught > 0) AS unique_fish,
             COALESCE(SUM(fc.total_caught), 0) AS total_fish
        FROM public.fish_caught fc
       GROUP BY fc.user_id
    ) agg ON agg.user_id = p.id
   WHERE agg.unique_fish > 0
   ORDER BY agg.unique_fish DESC, agg.total_fish DESC
   LIMIT GREATEST(1, LEAST(_limit, 100));
$$;

GRANT EXECUTE ON FUNCTION public.get_fish_leaderboard(integer) TO authenticated, anon;

-- Ship market leaderboard: rank by ship-market level.
CREATE OR REPLACE FUNCTION public.get_ship_market_leaderboard(_limit integer DEFAULT 30)
RETURNS TABLE(
  user_id uuid,
  display_name text,
  avatar_emoji text,
  avatar_url text,
  level integer,
  avatar_frame text,
  name_frame text,
  market_level integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
         p.avatar_frame, p.name_frame,
         um.level AS market_level
    FROM public.user_market um
    JOIN public.profiles p ON p.id = um.user_id
   ORDER BY um.level DESC, um.updated_at ASC
   LIMIT GREATEST(1, LEAST(_limit, 100));
$$;

GRANT EXECUTE ON FUNCTION public.get_ship_market_leaderboard(integer) TO authenticated, anon;
