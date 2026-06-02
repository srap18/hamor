ALTER TABLE public.user_market_state
  ADD COLUMN IF NOT EXISTS freeze_started_at timestamptz;

CREATE OR REPLACE FUNCTION public.buy_market_freeze(_hours int)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cost int;
  _ends timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  _cost := CASE _hours WHEN 2 THEN 50 WHEN 9 THEN 100 WHEN 24 THEN 150 ELSE NULL END;
  IF _cost IS NULL THEN RAISE EXCEPTION 'مدة غير صحيحة'; END IF;

  UPDATE public.profiles
  SET gems = gems - _cost
  WHERE id = _uid AND gems >= _cost;
  IF NOT FOUND THEN RAISE EXCEPTION 'جواهر غير كافية'; END IF;

  _ends := now() + (_hours || ' hours')::interval;

  INSERT INTO public.user_market_state(user_id, freeze_started_at, freeze_until, frozen_prices, updated_at)
  VALUES (_uid, now(), _ends, '{}'::jsonb, now())
  ON CONFLICT (user_id) DO UPDATE
    SET freeze_started_at = now(),
        freeze_until = EXCLUDED.freeze_until,
        frozen_prices = '{}'::jsonb,
        updated_at = now();

  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
  VALUES (_uid, 'market_rot_freeze', -_cost, 'gems', jsonb_build_object('hours', _hours));

  RETURN _ends;
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_market_freeze(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.sell_fish_caught(_fish_id text, _qty integer, _unit_price numeric DEFAULT NULL)
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
  _market_price numeric;
  _caught_at timestamptz;
  _freeze_started timestamptz;
  _freeze_until timestamptz;
  _age_end timestamptz;
  _hours numeric;
  _rot numeric;
  _final_unit numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty <= 0 THEN RAISE EXCEPTION 'invalid qty'; END IF;

  SELECT quantity, updated_at INTO _have, _caught_at
  FROM public.fish_caught
  WHERE user_id = _uid AND fish_id = _fish_id
  FOR UPDATE;

  IF _have IS NULL OR _have <= 0 THEN
    RAISE EXCEPTION 'no fish to sell';
  END IF;

  SELECT current_price INTO _market_price
  FROM public.fish_market_prices
  WHERE fish_id = _fish_id;

  IF _market_price IS NULL OR _market_price <= 0 THEN
    _market_price := GREATEST(0.1, COALESCE(_unit_price, 0.1));
  END IF;

  SELECT freeze_started_at, freeze_until INTO _freeze_started, _freeze_until
  FROM public.user_market_state
  WHERE user_id = _uid;

  _age_end := now();
  IF _freeze_started IS NOT NULL AND _freeze_until IS NOT NULL AND _freeze_until > now() THEN
    _age_end := GREATEST(_caught_at, _freeze_started);
  END IF;

  _hours := GREATEST(0, EXTRACT(EPOCH FROM (_age_end - _caught_at)) / 3600.0);
  _rot := GREATEST(0.5, 1 - (0.01 * _hours));
  _final_unit := GREATEST(0.1, round((_market_price * _rot)::numeric, 2));

  _sell := LEAST(_qty, _have);
  _remaining := _have - _sell;
  _earned := (_sell::numeric * _final_unit)::bigint;

  IF _remaining > 0 THEN
    UPDATE public.fish_caught
    SET quantity = _remaining
    WHERE user_id = _uid AND fish_id = _fish_id;
  ELSE
    DELETE FROM public.fish_caught
    WHERE user_id = _uid AND fish_id = _fish_id;
  END IF;

  UPDATE public.profiles
  SET coins = coins + _earned
  WHERE id = _uid
  RETURNING coins INTO _new_coins;

  INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
  VALUES (_uid, 'fish_sale', _earned, 'coins', jsonb_build_object(
    'fish_id', _fish_id,
    'qty', _sell,
    'unit_price', _final_unit,
    'quality_pct', round((_rot * 100)::numeric, 2),
    'server_priced', true
  ));

  remaining := _remaining;
  coins_earned := _earned;
  new_coins := _new_coins;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sell_fish_caught(text, integer, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_fish_leaderboard(_limit integer DEFAULT 100)
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
           COUNT(DISTINCT fc.fish_id) FILTER (WHERE fc.total_caught > 0)::int AS unique_fish,
           COALESCE(SUM(fc.total_caught), 0)::bigint AS total_fish
    FROM public.fish_caught fc
    GROUP BY fc.user_id
  ) agg ON agg.user_id = p.id
  WHERE agg.unique_fish > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id AND ur.role IN ('admin'::public.app_role, 'moderator'::public.app_role)
    )
  ORDER BY agg.unique_fish DESC, agg.total_fish DESC, p.xp DESC, p.id ASC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 100));
$$;

GRANT EXECUTE ON FUNCTION public.get_fish_leaderboard(integer) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.get_ship_market_leaderboard(_limit integer DEFAULT 100)
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
         p.avatar_frame, p.name_frame, um.level AS market_level
  FROM public.user_market um
  JOIN public.profiles p ON p.id = um.user_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p.id AND ur.role IN ('admin'::public.app_role, 'moderator'::public.app_role)
  )
  ORDER BY um.level DESC, p.xp DESC, um.updated_at ASC, p.id ASC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 100));
$$;

GRANT EXECUTE ON FUNCTION public.get_ship_market_leaderboard(integer) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.get_currency_leaderboard(_col text, _limit integer DEFAULT 100)
RETURNS TABLE(
  id uuid,
  display_name text,
  avatar_emoji text,
  avatar_url text,
  level integer,
  xp integer,
  coins bigint,
  gems integer,
  name_frame text,
  avatar_frame text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _col NOT IN ('coins', 'gems', 'xp') THEN
    RAISE EXCEPTION 'invalid column';
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level, p.xp, p.coins, p.gems, p.name_frame, p.avatar_frame
     FROM public.profiles p
     WHERE NOT EXISTS (
       SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = p.id AND ur.role IN (''admin''::public.app_role, ''moderator''::public.app_role)
     )
     ORDER BY p.%I DESC NULLS LAST, p.xp DESC NULLS LAST, p.id ASC
     LIMIT $1',
    _col
  ) USING GREATEST(1, LEAST(COALESCE(_limit, 100), 100));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_currency_leaderboard(text, integer) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.get_tribe_effort_leaderboard(_limit integer DEFAULT 100)
RETURNS TABLE(
  tribe_id uuid,
  name text,
  emblem text,
  banner text,
  level integer,
  members integer,
  donation_score bigint,
  support_score bigint,
  attack_score bigint,
  power bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH member_counts AS (
    SELECT p.tribe_id, COUNT(*)::integer AS members
    FROM public.profiles p
    WHERE p.tribe_id IS NOT NULL
    GROUP BY p.tribe_id
  ),
  support AS (
    SELECT sp.tribe_id,
           COALESCE(SUM(
             CASE
               WHEN sg.kind = 'gems' THEN GREATEST(0, sg.amount) * 1000
               WHEN sg.kind = 'repair' THEN GREATEST(0, sg.amount) * 350
               WHEN sg.kind = 'crew' THEN GREATEST(0, sg.amount) * 500
               ELSE GREATEST(0, sg.amount)
             END
           ), 0)::bigint AS score
    FROM public.support_gifts sg
    JOIN public.profiles sp ON sp.id = sg.sender_id
    JOIN public.profiles rp ON rp.id = sg.recipient_id
    WHERE sp.tribe_id IS NOT NULL
      AND sp.tribe_id = rp.tribe_id
      AND sg.sender_id <> sg.recipient_id
    GROUP BY sp.tribe_id
  ),
  attacks_by_tribe AS (
    SELECT ap.tribe_id,
           COALESCE(SUM(GREATEST(0, a.damage_dealt)), 0)::bigint
           + (COUNT(*)::bigint * 250)
           + (COUNT(*) FILTER (WHERE COALESCE(a.attacker_won, false))::bigint * 1500)
           + COALESCE(SUM(GREATEST(0, a.loot_coins) / 100), 0)::bigint AS score
    FROM public.attacks a
    JOIN public.profiles ap ON ap.id = a.attacker_id
    WHERE ap.tribe_id IS NOT NULL
    GROUP BY ap.tribe_id
  )
  SELECT t.id AS tribe_id,
         t.name,
         t.emblem,
         t.banner,
         COALESCE(t.level, 1) AS level,
         COALESCE(mc.members, 0) AS members,
         GREATEST(0, COALESCE(t.total_donations, 0))::bigint AS donation_score,
         COALESCE(s.score, 0)::bigint AS support_score,
         COALESCE(a.score, 0)::bigint AS attack_score,
         (
           GREATEST(0, COALESCE(t.total_donations, 0))::bigint
           + COALESCE(s.score, 0)::bigint
           + COALESCE(a.score, 0)::bigint
         )::bigint AS power
  FROM public.tribes t
  LEFT JOIN member_counts mc ON mc.tribe_id = t.id
  LEFT JOIN support s ON s.tribe_id = t.id
  LEFT JOIN attacks_by_tribe a ON a.tribe_id = t.id
  ORDER BY power DESC, attack_score DESC, support_score DESC, donation_score DESC, members DESC, level DESC, t.id ASC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 100));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_tribe_effort_leaderboard(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tribe_effort_leaderboard(integer) TO authenticated, service_role;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.fish_caught; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tribes; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tribe_donations; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.user_market; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.user_fish_market; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.fish_market_prices; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.user_market_state; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;