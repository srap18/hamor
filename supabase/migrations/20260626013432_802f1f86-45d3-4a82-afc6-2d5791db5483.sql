
-- ============================================================
-- DRAGON PEARLS & ARENA ECONOMY (preserve existing player levels)
-- ============================================================

-- 1) Add columns to dragons (rich progression metadata)
ALTER TABLE public.dragons
  ADD COLUMN IF NOT EXISTS pearls integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pearl_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_arena_date date,
  ADD COLUMN IF NOT EXISTS daily_arena_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_arena_extra_bought integer NOT NULL DEFAULT 0;

-- 2) Boss-kill pearl ledger (one row per (user, boss) for the 20-pearl reward)
CREATE TABLE IF NOT EXISTS public.dragon_boss_pearl_claims (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  boss_id  bigint NOT NULL,
  pearls   integer NOT NULL DEFAULT 20,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, boss_id)
);

GRANT SELECT ON public.dragon_boss_pearl_claims TO authenticated;
GRANT ALL    ON public.dragon_boss_pearl_claims TO service_role;

ALTER TABLE public.dragon_boss_pearl_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dbpc_select_own" ON public.dragon_boss_pearl_claims;
CREATE POLICY "dbpc_select_own"
  ON public.dragon_boss_pearl_claims FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 3) Helper: replicate JS overallLevel(stage, dp) in SQL
CREATE OR REPLACE FUNCTION public.compute_dragon_overall_level(_stage int, _dp bigint)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  thresholds bigint[] := ARRAY[
    0, 50000, 150000, 350000, 650000, 1000000, 1400000, 1900000,
    2600000, 3600000, 5100000, 7600000, 11600000, 18600000, 30600000
  ];
  form_idx int;
  base bigint;
  next_base bigint;
  span bigint;
  rel bigint;
  sub int;
BEGIN
  form_idx := GREATEST(1, LEAST(15, COALESCE(_stage, 1)));
  IF form_idx = 1 AND COALESCE(_dp, 0) <= 0 THEN
    RETURN 0;
  END IF;
  IF form_idx >= 15 THEN
    RETURN 150;
  END IF;
  base := thresholds[form_idx];
  next_base := thresholds[form_idx + 1];
  span := GREATEST(1, next_base - base);
  rel := GREATEST(0, COALESCE(_dp, 0) - base);
  sub := LEAST(10, FLOOR((rel::numeric / span::numeric) * 10)::int);
  RETURN (form_idx - 1) * 10 + GREATEST(1, sub + 1);
END;
$$;

-- 4) Backfill pearl_level for existing players to their CURRENT level
-- so they never regress and only future upgrades require pearls.
UPDATE public.dragons
   SET pearl_level = public.compute_dragon_overall_level(stage, dp)
 WHERE pearl_level = 0;

-- 5) Upgrade cost table per the spec
CREATE OR REPLACE FUNCTION public.dragon_pearl_upgrade_cost(_from_level int)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  n int := _from_level;
BEGIN
  IF n IS NULL OR n < 1 OR n >= 150 THEN RETURN NULL; END IF;
  -- cost to go from level n to n+1, where cost equals "cost of level (n+1)" per spec
  -- but spec phrases by destination; we use n as the level being purchased.
  -- Reread: cost per "upgrade" from L to L+1.
  -- L1..L9 (going to L2..L10): 15
  IF n <= 9 THEN
    RETURN 15;
  END IF;
  -- L10..L20 (going to L11..L21): each +50 above previous.
  -- L10→L11 = 65, L20→L21 = 565
  IF n <= 20 THEN
    RETURN 15 + (n - 9) * 50;
  END IF;
  -- L21..L40: +200 each over previous. L21→L22 = 765, L40→L41 = 4565
  IF n <= 40 THEN
    RETURN 565 + (n - 20) * 200;
  END IF;
  -- L41..L60: +400. L41→L42 = 4965, L60→L61 = 12565
  IF n <= 60 THEN
    RETURN 4565 + (n - 40) * 400;
  END IF;
  -- L61..L100: +600. L61→L62 = 13165, L100→L101 = 36565
  IF n <= 100 THEN
    RETURN 12565 + (n - 60) * 600;
  END IF;
  -- L101..L149: +650. L101→L102 = 37215, L149→L150 = 68415
  IF n <= 149 THEN
    RETURN 36565 + (n - 100) * 650;
  END IF;
  RETURN NULL;
END;
$$;

-- 6) Spend pearls to bump dragon level by 1 (max 150).
-- Also nudges dp/stage so existing code using stage/dp shows the new level.
CREATE OR REPLACE FUNCTION public.dragon_pearl_upgrade()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _d record;
  _eff int;
  _cost int;
  _new_level int;
  _new_form int;
  _sub int;
  _base bigint;
  _next bigint;
  _new_dp bigint;
  thresholds bigint[] := ARRAY[
    0, 50000, 150000, 350000, 650000, 1000000, 1400000, 1900000,
    2600000, 3600000, 5100000, 7600000, 11600000, 18600000, 30600000
  ];
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'auth'); END IF;
  SELECT * INTO _d FROM public.dragons WHERE user_id = _uid FOR UPDATE;
  IF _d IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_dragon'); END IF;

  _eff := GREATEST(COALESCE(_d.pearl_level, 0),
                   public.compute_dragon_overall_level(_d.stage, _d.dp));
  IF _eff >= 150 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'max_level');
  END IF;

  _cost := public.dragon_pearl_upgrade_cost(_eff);
  IF _cost IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_cost');
  END IF;
  IF COALESCE(_d.pearls, 0) < _cost THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'need_pearls',
                              'cost', _cost, 'have', COALESCE(_d.pearls, 0));
  END IF;

  _new_level := _eff + 1;
  _new_form := GREATEST(1, LEAST(15, ((_new_level - 1) / 10) + 1));
  _sub := (_new_level - 1) % 10;  -- 0..9

  IF _new_form >= 15 THEN
    _new_dp := thresholds[15];
  ELSE
    _base := thresholds[_new_form];
    _next := thresholds[_new_form + 1];
    -- place dp at the start of the sublevel band
    _new_dp := _base + ((_next - _base) * _sub) / 10;
  END IF;

  UPDATE public.dragons
     SET pearls = pearls - _cost,
         pearl_level = _new_level,
         stage = GREATEST(stage, _new_form),
         dp = GREATEST(dp, _new_dp),
         hatched_at = COALESCE(hatched_at, CASE WHEN _new_level >= 2 THEN now() ELSE hatched_at END),
         updated_at = now()
   WHERE user_id = _uid;

  RETURN jsonb_build_object(
    'ok', true,
    'spent', _cost,
    'level', _new_level,
    'pearls', COALESCE(_d.pearls, 0) - _cost,
    'stage', GREATEST(_d.stage, _new_form)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.dragon_pearl_upgrade() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dragon_pearl_upgrade_cost(int) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.compute_dragon_overall_level(int, bigint) TO authenticated, anon;

-- 7) Arena attack request — 5 free/day, then 5 × 200 gems, then 1000 gems each
CREATE OR REPLACE FUNCTION public.arena_attack_request()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _d record;
  _gems int;
  _free_left int;
  _extra_cost int;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'auth'); END IF;
  SELECT * INTO _d FROM public.dragons WHERE user_id = _uid FOR UPDATE;
  IF _d IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_dragon'); END IF;

  -- reset daily counters if a new day started
  IF _d.daily_arena_date IS DISTINCT FROM _today THEN
    UPDATE public.dragons
       SET daily_arena_date = _today,
           daily_arena_used = 0,
           daily_arena_extra_bought = 0
     WHERE user_id = _uid;
    _d.daily_arena_used := 0;
    _d.daily_arena_extra_bought := 0;
  END IF;

  _free_left := GREATEST(0, 5 - COALESCE(_d.daily_arena_used, 0));

  IF _free_left > 0 THEN
    UPDATE public.dragons SET daily_arena_used = daily_arena_used + 1, updated_at = now()
     WHERE user_id = _uid;
    RETURN jsonb_build_object('ok', true, 'kind', 'free',
                              'free_left', _free_left - 1,
                              'extra_bought', COALESCE(_d.daily_arena_extra_bought, 0));
  END IF;

  -- paid: first 5 extras = 200 gems, after that = 1000 gems
  IF COALESCE(_d.daily_arena_extra_bought, 0) < 5 THEN
    _extra_cost := 200;
  ELSE
    _extra_cost := 1000;
  END IF;

  SELECT COALESCE(gems, 0) INTO _gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _gems < _extra_cost THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'need_gems',
                              'cost', _extra_cost, 'have', _gems);
  END IF;

  UPDATE public.profiles SET gems = gems - _extra_cost WHERE id = _uid;
  UPDATE public.dragons
     SET daily_arena_used = daily_arena_used + 1,
         daily_arena_extra_bought = daily_arena_extra_bought + 1,
         updated_at = now()
   WHERE user_id = _uid;

  RETURN jsonb_build_object('ok', true, 'kind', 'paid',
                            'cost', _extra_cost,
                            'free_left', 0,
                            'extra_bought', COALESCE(_d.daily_arena_extra_bought, 0) + 1);
END;
$$;
GRANT EXECUTE ON FUNCTION public.arena_attack_request() TO authenticated;

-- Status only (no spend) — for HUD
CREATE OR REPLACE FUNCTION public.arena_attack_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _today date := (now() AT TIME ZONE 'UTC')::date;
  _d record;
  _used int; _extra int;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false); END IF;
  SELECT * INTO _d FROM public.dragons WHERE user_id = _uid;
  IF _d IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'free_left', 5, 'extra_bought', 0, 'next_cost', 200);
  END IF;
  IF _d.daily_arena_date IS DISTINCT FROM _today THEN
    _used := 0; _extra := 0;
  ELSE
    _used := COALESCE(_d.daily_arena_used, 0);
    _extra := COALESCE(_d.daily_arena_extra_bought, 0);
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'free_left', GREATEST(0, 5 - _used),
    'extra_bought', _extra,
    'next_cost', CASE WHEN _used < 5 THEN 0 WHEN _extra < 5 THEN 200 ELSE 1000 END
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.arena_attack_status() TO authenticated;

-- 8) Arena win reward — 2 pearls
CREATE OR REPLACE FUNCTION public.arena_award_pearls()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _new int;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'auth'); END IF;
  UPDATE public.dragons
     SET pearls = pearls + 2,
         pvp_wins = pvp_wins + 1,
         updated_at = now()
   WHERE user_id = _uid
  RETURNING pearls INTO _new;
  IF _new IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_dragon'); END IF;
  RETURN jsonb_build_object('ok', true, 'pearls', _new, 'awarded', 2);
END;
$$;
GRANT EXECUTE ON FUNCTION public.arena_award_pearls() TO authenticated;

-- 9) Boss kill reward — 20 pearls, once per boss
CREATE OR REPLACE FUNCTION public.boss_award_pearls(_boss_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _new int;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'auth'); END IF;
  IF _boss_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_args'); END IF;

  -- claim row; if already exists, skip
  INSERT INTO public.dragon_boss_pearl_claims(user_id, boss_id, pearls)
  VALUES (_uid, _boss_id, 20)
  ON CONFLICT (user_id, boss_id) DO NOTHING;

  IF NOT FOUND THEN
    SELECT pearls INTO _new FROM public.dragons WHERE user_id = _uid;
    RETURN jsonb_build_object('ok', false, 'reason', 'already_claimed', 'pearls', COALESCE(_new, 0));
  END IF;

  UPDATE public.dragons
     SET pearls = pearls + 20,
         updated_at = now()
   WHERE user_id = _uid
  RETURNING pearls INTO _new;
  IF _new IS NULL THEN
    -- no dragon row yet; create the minimum row so the pearls stick
    INSERT INTO public.dragons(user_id, pearls) VALUES (_uid, 20)
    ON CONFLICT (user_id) DO UPDATE SET pearls = public.dragons.pearls + 20;
    SELECT pearls INTO _new FROM public.dragons WHERE user_id = _uid;
  END IF;
  RETURN jsonb_build_object('ok', true, 'pearls', _new, 'awarded', 20);
END;
$$;
GRANT EXECUTE ON FUNCTION public.boss_award_pearls(bigint) TO authenticated;

-- 10) Helpful index for daily resets and lookups
CREATE INDEX IF NOT EXISTS idx_dragons_daily_arena_date ON public.dragons(daily_arena_date);
