-- Prevent concurrent duplicate daily-login claims for the same player.
CREATE OR REPLACE FUNCTION public.claim_daily_login_pirate()
RETURNS TABLE(
  day_index integer,
  reward_type text,
  reward_id text,
  reward_qty integer,
  new_streak integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _streak int := 0;
  _last date;
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _new_streak int;
  _idx int;
  _r_type text;
  _r_id text;
  _r_qty int;
  _existing int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- One transaction at a time per player, so close/open or fast taps cannot double-award.
  PERFORM pg_advisory_xact_lock(hashtextextended(_uid::text, 51001));

  SELECT current_streak, last_claim_date INTO _streak, _last
    FROM public.daily_login_streaks WHERE user_id = _uid FOR UPDATE;

  IF _last = _today THEN RAISE EXCEPTION 'already claimed today'; END IF;

  IF _last IS NULL OR _last < _today - 1 THEN
    _new_streak := 1;
  ELSE
    _new_streak := _streak + 1;
  END IF;

  _idx := ((_new_streak - 1) % 15);

  CASE _idx
    WHEN 0  THEN _r_type := 'coins';  _r_id := 'coins';         _r_qty := 1000;
    WHEN 1  THEN _r_type := 'weapon'; _r_id := 'rocket_small';  _r_qty := 4;
    WHEN 2  THEN _r_type := 'crew';   _r_id := 'sailor';        _r_qty := 1;
    WHEN 3  THEN _r_type := 'weapon'; _r_id := 'rocket_small';  _r_qty := 5;
    WHEN 4  THEN _r_type := 'coins';  _r_id := 'coins';         _r_qty := 3000;
    WHEN 5  THEN _r_type := 'weapon'; _r_id := 'rocket_medium'; _r_qty := 5;
    WHEN 6  THEN _r_type := 'crew';   _r_id := 'fixer_1';       _r_qty := 1;
    WHEN 7  THEN _r_type := 'weapon'; _r_id := 'rocket_medium'; _r_qty := 6;
    WHEN 8  THEN _r_type := 'gems';   _r_id := 'gems';          _r_qty := 20;
    WHEN 9  THEN _r_type := 'weapon'; _r_id := 'rocket_large';  _r_qty := 7;
    WHEN 10 THEN _r_type := 'crew';   _r_id := 'guide';         _r_qty := 1;
    WHEN 11 THEN _r_type := 'weapon'; _r_id := 'rocket_large';  _r_qty := 8;
    WHEN 12 THEN _r_type := 'crew';   _r_id := 'luck';          _r_qty := 1;
    WHEN 13 THEN _r_type := 'coins';  _r_id := 'coins';         _r_qty := 15000;
    WHEN 14 THEN _r_type := 'weapon'; _r_id := 'nuke';          _r_qty := 10;
  END CASE;

  IF _r_type = 'coins' THEN
    UPDATE public.profiles SET coins = coins + _r_qty WHERE id = _uid;
  ELSIF _r_type = 'gems' THEN
    UPDATE public.profiles SET gems = gems + _r_qty WHERE id = _uid;
  ELSE
    SELECT quantity INTO _existing
      FROM public.inventory
      WHERE user_id = _uid AND item_type = _r_type AND item_id = _r_id
      FOR UPDATE;
    IF _existing IS NULL THEN
      INSERT INTO public.inventory(user_id, item_type, item_id, quantity)
        VALUES (_uid, _r_type, _r_id, _r_qty);
    ELSE
      UPDATE public.inventory
        SET quantity = quantity + _r_qty
        WHERE user_id = _uid AND item_type = _r_type AND item_id = _r_id;
    END IF;
  END IF;

  INSERT INTO public.daily_login_streaks(user_id, current_streak, last_claim_date, total_claims)
    VALUES (_uid, _new_streak, _today, 1)
    ON CONFLICT (user_id) DO UPDATE
      SET current_streak = _new_streak,
          last_claim_date = _today,
          total_claims = public.daily_login_streaks.total_claims + 1,
          updated_at = now();

  day_index := _idx;
  reward_type := _r_type;
  reward_id := _r_id;
  reward_qty := _r_qty;
  new_streak := _new_streak;
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.claim_daily_login_pirate() TO authenticated;

-- Competition catch logs now support one row carrying a quantity.
ALTER TABLE public.competition_catches
  ADD COLUMN IF NOT EXISTS qty integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS cc_time_user_idx ON public.competition_catches (caught_at, user_id);
CREATE INDEX IF NOT EXISTS cc_time_fish_idx ON public.competition_catches (caught_at, fish_id);

CREATE OR REPLACE FUNCTION public.log_competition_catch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
  VALUES (NEW.user_id, NEW.fish_id, COALESCE(NEW.caught_at, now()), 1);
  RETURN NEW;
END;
$$;

-- Fishing collection is fully server-authoritative: elapsed time, crew boosts,
-- quantity, and end-of-trip state are all decided in this locked transaction.
CREATE OR REPLACE FUNCTION public.collect_fishing_reward(_ship_id uuid, _requested_fish_id text DEFAULT NULL)
RETURNS TABLE(
  fish_id text,
  fish_qty integer,
  base_qty integer,
  luck_bonus integer,
  xp_awarded integer,
  elapsed_seconds integer,
  duration_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _ship record;
  _cat record;
  _pool jsonb;
  _pool_len integer;
  _chosen text;
  _capacity integer;
  _duration integer;
  _elapsed numeric;
  _ratio numeric;
  _sailor_mult numeric := 1;
  _luck_mult integer := 1;
  _has_guide boolean := false;
  _base integer;
  _qty integer;
  _xp integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _ship
  FROM public.ships_owned
  WHERE id = _ship_id
  FOR UPDATE;

  IF _ship.id IS NULL OR _ship.user_id <> _uid THEN
    RAISE EXCEPTION 'not your ship';
  END IF;

  IF _ship.destroyed_at IS NOT NULL AND _ship.repair_ends_at IS NOT NULL AND _ship.repair_ends_at > now() THEN
    UPDATE public.ships_owned
       SET at_sea = false, fishing_started_at = NULL
     WHERE id = _ship_id;
    RAISE EXCEPTION 'ship_destroyed';
  END IF;

  IF NOT COALESCE(_ship.at_sea, false) OR _ship.fishing_started_at IS NULL THEN
    RAISE EXCEPTION 'not_fishing';
  END IF;

  IF _ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat
    FROM public.ship_catalog
    WHERE code = _ship.catalog_code AND active = true
    LIMIT 1;
  END IF;

  IF _cat.id IS NULL THEN
    SELECT * INTO _cat
    FROM public.ship_catalog
    WHERE sort_order = COALESCE(_ship.template_id, 1) AND active = true
    ORDER BY market_level_required ASC
    LIMIT 1;
  END IF;

  IF _cat.id IS NULL THEN
    RAISE EXCEPTION 'ship_catalog_missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.inventory inv
    WHERE inv.user_id = _uid
      AND inv.item_type = 'crew'
      AND inv.item_id = 'sailor'
      AND inv.meta->>'assigned_ship_id' = _ship_id::text
      AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())
  ) INTO _has_guide;
  IF _has_guide THEN _sailor_mult := 1.4; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.inventory inv
    WHERE inv.user_id = _uid
      AND inv.item_type = 'crew'
      AND inv.item_id = 'luck'
      AND inv.meta->>'assigned_ship_id' = _ship_id::text
      AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())
  ) INTO _has_guide;
  IF _has_guide THEN _luck_mult := 2; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.inventory inv
    WHERE inv.user_id = _uid
      AND inv.item_type = 'crew'
      AND inv.item_id = 'guide'
      AND inv.meta->>'assigned_ship_id' = _ship_id::text
      AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())
  ) INTO _has_guide;

  _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
  _pool_len := jsonb_array_length(_pool);
  IF _pool_len <= 0 THEN
    RAISE EXCEPTION 'empty_fish_pool';
  END IF;

  IF _has_guide
     AND _requested_fish_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _requested_fish_id) THEN
    _chosen := _requested_fish_id;
  ELSE
    SELECT value INTO _chosen
    FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
    WHERE ord = (1 + (abs(hashtextextended(_ship_id::text || ':' || _ship.fishing_started_at::text, 71003)) % _pool_len))
    LIMIT 1;
  END IF;

  _duration := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
  _capacity := GREATEST(1, CASE WHEN COALESCE(_ship.template_id, 0) = 32 THEN COALESCE(_ship.max_hp, _cat.storage, 10) ELSE COALESCE(_cat.storage, 10) END);
  _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - _ship.fishing_started_at)) * _sailor_mult);
  _ratio := LEAST(1, _elapsed / _duration);
  _base := FLOOR(_capacity * _ratio)::integer;
  _qty := _base * _luck_mult;
  _xp := CASE WHEN _qty > 0 THEN LEAST(50 + COALESCE(_ship.template_id, 1) * 40, GREATEST(5, FLOOR(_qty * 0.4)::integer + COALESCE(_ship.template_id, 1) * 5)) ELSE 0 END;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         last_fishing_reward_at = CASE WHEN _qty > 0 THEN now() ELSE last_fishing_reward_at END
   WHERE id = _ship_id;

  IF _qty > 0 THEN
    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    VALUES (_uid, _chosen, _qty, _qty)
    ON CONFLICT (user_id, fish_id) DO UPDATE
    SET quantity = public.fish_caught.quantity + _qty,
        total_caught = public.fish_caught.total_caught + _qty,
        updated_at = now();

    INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
    VALUES (_uid, _chosen, now(), _qty);

    PERFORM public._mutate_currency(_uid, 0, 0, 0, _xp);
  END IF;

  fish_id := _chosen;
  fish_qty := _qty;
  base_qty := _base;
  luck_bonus := GREATEST(0, _qty - _base);
  xp_awarded := _xp;
  elapsed_seconds := FLOOR(_elapsed)::integer;
  duration_seconds := _duration;
  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.collect_fishing_reward(uuid, text) TO authenticated;

-- Retire the old client-controlled fish increment path.
REVOKE EXECUTE ON FUNCTION public.increment_fish_caught(text, integer) FROM authenticated, anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.fish_caught FROM authenticated, anon, public;
GRANT SELECT ON public.fish_caught TO authenticated;
GRANT ALL ON public.fish_caught TO service_role;

-- Leaderboard returns 100 players and counts catch quantities, not only rows.
CREATE OR REPLACE FUNCTION public.get_competition_leaderboard(_competition_id uuid)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  avatar_emoji text,
  avatar_url text,
  level integer,
  score bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
BEGIN
  SELECT * INTO c FROM public.competitions WHERE id = _competition_id;
  IF c IS NULL THEN
    RETURN;
  END IF;

  IF c.metric = 'explode_count' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COUNT(*)::bigint AS score
    FROM public.attacks a
    JOIN public.profiles p ON p.id = a.attacker_id
    WHERE a.created_at >= c.starts_at AND a.created_at <= c.ends_at
      AND a.damage_dealt > 0
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 100;

  ELSIF c.metric = 'explode_damage' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(a.damage_dealt),0)::bigint AS score
    FROM public.attacks a
    JOIN public.profiles p ON p.id = a.attacker_id
    WHERE a.created_at >= c.starts_at AND a.created_at <= c.ends_at
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 100;

  ELSIF c.metric = 'fish_total' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(cc.qty),0)::bigint AS score
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 100;

  ELSIF c.metric = 'fish_specific' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(cc.qty),0)::bigint AS score
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
      AND cc.fish_id = c.target_fish_id
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 100;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_competition_leaderboard(uuid) TO anon, authenticated;