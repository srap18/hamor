
-- ============================================================
-- 1) New columns on profiles
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS xp_today integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS xp_today_date date,
  ADD COLUMN IF NOT EXISTS skill_points integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skill_str integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skill_def integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skill_luck integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skill_fish integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skill_speed integer NOT NULL DEFAULT 0;

-- ============================================================
-- 2) Precomputed XP curve table  (Levels 1..1000)
--    Formula: cost to go L -> L+1 = floor(100 * L^1.5)
--    cumulative_xp[L] = XP threshold to *reach* level L
-- ============================================================
CREATE TABLE IF NOT EXISTS public.level_xp_table (
  level integer PRIMARY KEY,
  cumulative_xp bigint NOT NULL,
  to_next bigint NOT NULL
);

GRANT SELECT ON public.level_xp_table TO anon, authenticated;
GRANT ALL ON public.level_xp_table TO service_role;

ALTER TABLE public.level_xp_table ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lxp_all_view" ON public.level_xp_table;
CREATE POLICY "lxp_all_view" ON public.level_xp_table FOR SELECT USING (true);

DELETE FROM public.level_xp_table;
WITH per AS (
  SELECT lv AS level, FLOOR(100 * POWER(lv, 1.5))::bigint AS cost
  FROM generate_series(1, 1000) AS lv
)
INSERT INTO public.level_xp_table(level, cumulative_xp, to_next)
SELECT
  p.level,
  COALESCE((SELECT SUM(cost) FROM per WHERE per.level < p.level), 0)::bigint,
  p.cost
FROM per p;

-- ============================================================
-- 3) Helpers: level_from_xp, xp_progress, scaling, daily cap
-- ============================================================
CREATE OR REPLACE FUNCTION public.level_from_xp(_xp bigint)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT level FROM public.level_xp_table
      WHERE cumulative_xp <= GREATEST(0, _xp)
      ORDER BY level DESC LIMIT 1),
    1
  )
$$;
GRANT EXECUTE ON FUNCTION public.level_from_xp(bigint) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.xp_gain_scale(_level integer)
RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _level <= 100 THEN 1.0
    WHEN _level <= 300 THEN 0.9
    WHEN _level <= 600 THEN 0.75
    WHEN _level <= 800 THEN 0.6
    ELSE 0.4
  END::numeric
$$;

CREATE OR REPLACE FUNCTION public.daily_xp_cap()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 100000 $$;

CREATE OR REPLACE FUNCTION public.xp_progress(_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'xp', p.xp,
    'level', p.level,
    'max_level', 1000,
    'current_threshold', COALESCE(c.cumulative_xp, 0),
    'next_threshold', COALESCE(n.cumulative_xp, c.cumulative_xp),
    'to_next', COALESCE(c.to_next, 0),
    'into_level', GREATEST(0, p.xp - COALESCE(c.cumulative_xp, 0)),
    'xp_today', p.xp_today,
    'daily_cap', public.daily_xp_cap(),
    'skill_points', p.skill_points,
    'scale', public.xp_gain_scale(p.level)
  )
  FROM public.profiles p
  LEFT JOIN public.level_xp_table c ON c.level = p.level
  LEFT JOIN public.level_xp_table n ON n.level = p.level + 1
  WHERE p.id = _user
$$;
GRANT EXECUTE ON FUNCTION public.xp_progress(uuid) TO authenticated;

-- ============================================================
-- 4) Auto-sync level + cap from xp via BEFORE UPDATE trigger
--    Replaces the simple sqrt formula previously baked into
--    _mutate_currency / admin RPCs. Any path that mutates xp
--    on profiles now keeps level consistent and awards skill points.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_level_from_xp()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  _max_xp bigint;
  _new_level integer;
  _old_level integer;
BEGIN
  IF NEW.xp IS DISTINCT FROM OLD.xp THEN
    SELECT cumulative_xp INTO _max_xp FROM public.level_xp_table WHERE level = 1000;
    IF NEW.xp > _max_xp THEN NEW.xp := _max_xp; END IF;
    IF NEW.xp < 0 THEN NEW.xp := 0; END IF;

    _old_level := COALESCE(OLD.level, 1);
    _new_level := public.level_from_xp(NEW.xp);

    -- award skill points on level-up only (not on direct level edits)
    IF _new_level > _old_level THEN
      NEW.skill_points := COALESCE(OLD.skill_points, 0) + (_new_level - _old_level);
    END IF;

    NEW.level := _new_level;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_level_from_xp ON public.profiles;
CREATE TRIGGER trg_sync_level_from_xp
  BEFORE UPDATE OF xp ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_level_from_xp();

-- ============================================================
-- 5) Decouple weekly_xp from level xp
--    track_weekly_xp used to mirror every xp delta into weekly_xp.
--    Replace its body with a no-op so weekly_xp now only changes via
--    explicit awards (award_event_xp / event finalize / admin tools).
-- ============================================================
CREATE OR REPLACE FUNCTION public.track_weekly_xp()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.award_event_xp(_user uuid, _amount integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RETURN 0; END IF;
  UPDATE public.profiles
     SET weekly_xp = COALESCE(weekly_xp, 0) + _amount
   WHERE id = _user;
  RETURN _amount;
END $$;
GRANT EXECUTE ON FUNCTION public.award_event_xp(uuid, integer) TO service_role;

-- ============================================================
-- 6) Rewrite _mutate_currency: daily cap + scaling for positive xp,
--    let trigger compute level. Keeps the same signature & ledger.
-- ============================================================
CREATE OR REPLACE FUNCTION public._mutate_currency(
  _user uuid,
  _coins bigint DEFAULT 0,
  _gems integer DEFAULT 0,
  _rubies integer DEFAULT 0,
  _xp integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cur record;
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _cap integer := public.daily_xp_cap();
  _scaled integer := 0;
  _allowed integer := 0;
  _today_count integer;
  _xp_delta integer := 0;
BEGIN
  SELECT coins, gems, rubies, xp, level, xp_today, xp_today_date
    INTO _cur FROM public.profiles WHERE id = _user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no profile'; END IF;
  IF _cur.coins  + _coins  < 0 THEN RAISE EXCEPTION 'insufficient coins'; END IF;
  IF _cur.gems   + _gems   < 0 THEN RAISE EXCEPTION 'insufficient gems'; END IF;
  IF _cur.rubies + _rubies < 0 THEN RAISE EXCEPTION 'insufficient rubies'; END IF;

  _xp_delta := COALESCE(_xp, 0);
  IF _xp_delta > 0 THEN
    -- diminishing returns by level band
    _scaled := FLOOR(_xp_delta * public.xp_gain_scale(_cur.level))::int;

    -- daily cap (UTC day)
    _today_count := CASE WHEN _cur.xp_today_date = _today THEN COALESCE(_cur.xp_today, 0) ELSE 0 END;
    _allowed := GREATEST(0, _cap - _today_count);
    _xp_delta := LEAST(_scaled, _allowed);

    UPDATE public.profiles
       SET coins = coins + _coins,
           gems  = gems  + _gems,
           rubies = rubies + _rubies,
           xp    = xp + _xp_delta,
           xp_today = _today_count + _xp_delta,
           xp_today_date = _today
     WHERE id = _user;
  ELSE
    -- negative or zero xp: no cap/scaling
    UPDATE public.profiles
       SET coins = coins + _coins,
           gems  = gems  + _gems,
           rubies = rubies + _rubies,
           xp    = GREATEST(0, xp + _xp_delta)
     WHERE id = _user;
  END IF;

  IF _coins <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind)
    VALUES (_user, _coins, 'coins', 'mutate');
  END IF;
  IF _gems <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind)
    VALUES (_user, _gems, 'gems', 'mutate');
  END IF;
  IF _rubies <> 0 THEN
    INSERT INTO public.transactions(user_id, amount, currency, kind)
    VALUES (_user, _rubies, 'rubies', 'mutate');
  END IF;
END $$;

-- ============================================================
-- 7) Patch finalize_competition: event xp prize -> weekly_xp,
--    not level xp.
-- ============================================================
CREATE OR REPLACE FUNCTION public.finalize_competition(_competition_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c RECORD;
  tier jsonb;
  rank_idx int;
  winner_uid uuid;
  winner_score bigint;
  prize_count int;
  coins_amt bigint;
  gems_amt int;
  rubies_amt int;
  xp_amt int;
  items_arr jsonb;
  item jsonb;
  it_type text;
  it_code text;
  it_qty int;
  template_lvl int;
BEGIN
  SELECT * INTO c FROM public.competitions WHERE id = _competition_id FOR UPDATE;
  IF c.id IS NULL THEN RETURN; END IF;
  IF c.prizes_distributed_at IS NOT NULL THEN RETURN; END IF;
  IF c.ends_at > now() THEN RETURN; END IF;
  IF c.prize_tiers IS NULL OR jsonb_array_length(c.prize_tiers) = 0 THEN
    IF (c.reward_coins + c.reward_gems + c.reward_xp) > 0 THEN
      c.prize_tiers := jsonb_build_array(jsonb_build_object(
        'rank', 1,
        'coins', c.reward_coins,
        'gems', c.reward_gems,
        'xp', c.reward_xp,
        'text', c.reward_text
      ));
    ELSE
      UPDATE public.competitions SET prizes_distributed_at = now() WHERE id = _competition_id;
      RETURN;
    END IF;
  END IF;

  prize_count := jsonb_array_length(c.prize_tiers);

  FOR rank_idx, winner_uid, winner_score IN
    SELECT row_number() OVER (ORDER BY score DESC, user_id) AS rn, user_id, score
    FROM (
      SELECT user_id, score FROM (
        SELECT a.attacker_id AS user_id, COUNT(*)::bigint AS score
        FROM public.attacks a
        WHERE c.metric = 'explode_count'
          AND a.created_at >= c.starts_at AND a.created_at <= c.ends_at
          AND a.damage_dealt > 0
        GROUP BY a.attacker_id
        UNION ALL
        SELECT a.attacker_id AS user_id, COALESCE(SUM(a.damage_dealt),0)::bigint AS score
        FROM public.attacks a
        WHERE c.metric = 'explode_damage'
          AND a.created_at >= c.starts_at AND a.created_at <= c.ends_at
        GROUP BY a.attacker_id
        UNION ALL
        SELECT cc.user_id, COALESCE(SUM(cc.qty),0)::bigint AS score
        FROM public.competition_catches cc
        WHERE c.metric = 'fish_total'
          AND cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
        GROUP BY cc.user_id
        UNION ALL
        SELECT cc.user_id, COALESCE(SUM(cc.qty),0)::bigint AS score
        FROM public.competition_catches cc
        WHERE c.metric = 'fish_specific'
          AND cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
          AND cc.fish_id = c.target_fish_id
        GROUP BY cc.user_id
      ) all_metrics
      WHERE user_id IS NOT NULL AND score > 0
    ) lb
    LIMIT prize_count
  LOOP
    tier := c.prize_tiers -> (rank_idx - 1);
    IF tier IS NULL THEN EXIT; END IF;

    coins_amt  := COALESCE((tier->>'coins')::bigint, 0);
    gems_amt   := COALESCE((tier->>'gems')::int, 0);
    rubies_amt := COALESCE((tier->>'rubies')::int, 0);
    xp_amt     := COALESCE((tier->>'xp')::int, 0);

    -- Coins / gems / rubies via the normal currency path (NO level xp)
    IF (coins_amt + gems_amt + rubies_amt) > 0 THEN
      PERFORM public._mutate_currency(winner_uid, coins_amt, gems_amt, rubies_amt, 0);
    END IF;
    -- "XP" prize from competitions is event/ranking XP only
    IF xp_amt > 0 THEN
      PERFORM public.award_event_xp(winner_uid, xp_amt);
    END IF;

    items_arr := COALESCE(tier->'items', '[]'::jsonb);
    FOR item IN SELECT * FROM jsonb_array_elements(items_arr)
    LOOP
      it_type := item->>'type';
      it_code := item->>'code';
      it_qty  := GREATEST(1, COALESCE((item->>'qty')::int, 1));
      IF it_type IS NULL OR it_code IS NULL THEN CONTINUE; END IF;

      IF it_type = 'ship' THEN
        template_lvl := COALESCE(NULLIF(regexp_replace(it_code, '\D', '', 'g'), '')::int, 1);
        FOR i IN 1..it_qty LOOP
          INSERT INTO public.ships_owned(user_id, template_id, catalog_code, hp, max_hp, in_storage)
          VALUES (winner_uid, template_lvl, it_code, 100, 100, true);
        END LOOP;
      ELSIF it_type = 'fish' THEN
        INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught, updated_at)
        VALUES (winner_uid, it_code, it_qty, it_qty, now())
        ON CONFLICT (user_id, fish_id) DO UPDATE
          SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
              total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
              updated_at = now();
      ELSIF it_type IN ('crew','weapon','consumable','decoration','frame','background','name_frame','bubble_frame','profile_frame','shield') THEN
        INSERT INTO public.inventory(user_id, item_type, item_id, quantity)
        VALUES (winner_uid, it_type, it_code, it_qty)
        ON CONFLICT (user_id, item_type, item_id) WHERE meta IS NULL OR (meta ->> 'assigned_ship_id'::text) IS NULL
        DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.competitions
     SET prizes_distributed_at = now()
   WHERE id = _competition_id;
END $$;

-- ============================================================
-- 8) Skill point allocation RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.allocate_skill_point(_stat text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _have integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _stat NOT IN ('str','def','luck','fish','speed') THEN
    RAISE EXCEPTION 'invalid stat';
  END IF;

  SELECT skill_points INTO _have FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _have IS NULL OR _have <= 0 THEN RAISE EXCEPTION 'no skill points'; END IF;

  IF _stat = 'str' THEN
    UPDATE public.profiles SET skill_str = skill_str + 1, skill_points = skill_points - 1 WHERE id = _uid;
  ELSIF _stat = 'def' THEN
    UPDATE public.profiles SET skill_def = skill_def + 1, skill_points = skill_points - 1 WHERE id = _uid;
  ELSIF _stat = 'luck' THEN
    UPDATE public.profiles SET skill_luck = skill_luck + 1, skill_points = skill_points - 1 WHERE id = _uid;
  ELSIF _stat = 'fish' THEN
    UPDATE public.profiles SET skill_fish = skill_fish + 1, skill_points = skill_points - 1 WHERE id = _uid;
  ELSIF _stat = 'speed' THEN
    UPDATE public.profiles SET skill_speed = skill_speed + 1, skill_points = skill_points - 1 WHERE id = _uid;
  END IF;

  RETURN (SELECT to_jsonb(p) FROM (
    SELECT skill_points, skill_str, skill_def, skill_luck, skill_fish, skill_speed
    FROM public.profiles WHERE id = _uid
  ) p);
END $$;
GRANT EXECUTE ON FUNCTION public.allocate_skill_point(text) TO authenticated;

-- ============================================================
-- 9) Recompute every existing player's level + grant initial skill points
--    Cap xp at level-1000 ceiling first so trigger doesn't overshoot.
-- ============================================================
DO $do$
DECLARE
  _max_xp bigint;
BEGIN
  SELECT cumulative_xp INTO _max_xp FROM public.level_xp_table WHERE level = 1000;

  UPDATE public.profiles SET xp = LEAST(xp, _max_xp) WHERE xp > _max_xp;
  -- Force a no-op-but-not-distinct write to recompute level via trigger:
  -- bump and unbump xp by 0 won't trigger (NOT DISTINCT). Use direct compute.
  UPDATE public.profiles
     SET level = public.level_from_xp(xp);

  UPDATE public.profiles
     SET skill_points = GREATEST(0, level - 1
                                 - skill_str - skill_def - skill_luck - skill_fish - skill_speed);
END $do$;
