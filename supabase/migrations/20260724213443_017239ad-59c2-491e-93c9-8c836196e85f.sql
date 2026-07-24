
-- ============ SEASONS SYSTEM ============

-- 1) seasons
CREATE TABLE IF NOT EXISTS public.seasons (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_seasons_one_active
  ON public.seasons(status) WHERE status = 'active';

GRANT SELECT ON public.seasons TO anon, authenticated;
GRANT ALL ON public.seasons TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.seasons_id_seq TO service_role;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seasons_read_all" ON public.seasons FOR SELECT USING (true);

-- 2) season_damage
CREATE TABLE IF NOT EXISTS public.season_damage (
  season_id int NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  damage_total bigint NOT NULL DEFAULT 0,
  first_reached_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_season_damage_rank
  ON public.season_damage(season_id, damage_total DESC, first_reached_at ASC);

GRANT SELECT ON public.season_damage TO anon, authenticated;
GRANT ALL ON public.season_damage TO service_role;
ALTER TABLE public.season_damage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "season_damage_read_all" ON public.season_damage FOR SELECT USING (true);

-- 3) season_damage_events (idempotency)
CREATE TABLE IF NOT EXISTS public.season_damage_events (
  season_id int NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  attack_id uuid NOT NULL,
  user_id uuid NOT NULL,
  damage int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, attack_id)
);
CREATE INDEX IF NOT EXISTS idx_season_dmg_events_user
  ON public.season_damage_events(season_id, user_id);

GRANT SELECT ON public.season_damage_events TO authenticated;
GRANT ALL ON public.season_damage_events TO service_role;
ALTER TABLE public.season_damage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "season_events_read_own" ON public.season_damage_events
  FOR SELECT USING (auth.uid() = user_id);

-- 4) season_results
CREATE TABLE IF NOT EXISTS public.season_results (
  season_id int NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  final_rank int NOT NULL,
  final_damage bigint NOT NULL,
  frame_tier int NOT NULL DEFAULT 0,
  reward_gems bigint NOT NULL DEFAULT 0,
  granted_at timestamptz NOT NULL DEFAULT now(),
  tx_id uuid,
  PRIMARY KEY (season_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_season_results_rank
  ON public.season_results(season_id, final_rank ASC);
CREATE INDEX IF NOT EXISTS idx_season_results_user
  ON public.season_results(user_id, season_id DESC);

GRANT SELECT ON public.season_results TO anon, authenticated;
GRANT ALL ON public.season_results TO service_role;
ALTER TABLE public.season_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "season_results_read_all" ON public.season_results FOR SELECT USING (true);

-- 5) season_frame_tier(damage)
CREATE OR REPLACE FUNCTION public.season_frame_tier(_damage bigint)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _damage >= 1000000000 THEN 10
    WHEN _damage >=  900000000 THEN 9
    WHEN _damage >=  800000000 THEN 8
    WHEN _damage >=  700000000 THEN 7
    WHEN _damage >=  600000000 THEN 6
    WHEN _damage >=  500000000 THEN 5
    WHEN _damage >=  400000000 THEN 4
    WHEN _damage >=  300000000 THEN 3
    WHEN _damage >=  200000000 THEN 2
    WHEN _damage >=  100000000 THEN 1
    ELSE 0
  END;
$$;

-- 6) current_season() — creates SEASON 01 if none active
CREATE OR REPLACE FUNCTION public.current_season()
RETURNS public.seasons
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.seasons;
  next_num int;
BEGIN
  SELECT * INTO s FROM public.seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1;
  IF FOUND THEN
    RETURN s;
  END IF;

  SELECT COALESCE(MAX(id), 0) + 1 INTO next_num FROM public.seasons;
  INSERT INTO public.seasons(code, name, starts_at, ends_at, status)
  VALUES (
    'S' || lpad(next_num::text, 2, '0'),
    'SEASON ' || lpad(next_num::text, 2, '0'),
    now(),
    now() + interval '3 months',
    'active'
  )
  RETURNING * INTO s;
  RETURN s;
END;
$$;
GRANT EXECUTE ON FUNCTION public.current_season() TO anon, authenticated;

-- 7) Trigger: record damage to season on each attack (idempotent)
CREATE OR REPLACE FUNCTION public.trg_season_record_damage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s_id int;
  d int;
  inserted boolean := false;
BEGIN
  d := COALESCE(NEW.damage_dealt, 0);
  IF d <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT id INTO s_id FROM public.seasons
    WHERE status = 'active' AND now() BETWEEN starts_at AND ends_at
    ORDER BY id DESC LIMIT 1;
  IF s_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Idempotency: only count each attack once per season
  INSERT INTO public.season_damage_events(season_id, attack_id, user_id, damage)
  VALUES (s_id, NEW.id, NEW.attacker_id, d)
  ON CONFLICT (season_id, attack_id) DO NOTHING;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF NOT inserted THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.season_damage(season_id, user_id, damage_total, first_reached_at, updated_at)
  VALUES (s_id, NEW.attacker_id, d, now(), now())
  ON CONFLICT (season_id, user_id) DO UPDATE
    SET damage_total = public.season_damage.damage_total + EXCLUDED.damage_total,
        updated_at = now();

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never break the parent attack insert
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS t_season_record_damage ON public.attacks;
CREATE TRIGGER t_season_record_damage
  AFTER INSERT ON public.attacks
  FOR EACH ROW EXECUTE FUNCTION public.trg_season_record_damage();

-- 8) close_season — atomic, idempotent
CREATE OR REPLACE FUNCTION public.close_season(_season_id int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.seasons;
  next_num int;
  reward bigint;
  r record;
  rewarded int := 0;
BEGIN
  SELECT * INTO s FROM public.seasons WHERE id = _season_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'season_not_found');
  END IF;
  IF s.status = 'closed' THEN
    RETURN jsonb_build_object('ok', true, 'already_closed', true);
  END IF;

  -- Freeze results
  FOR r IN
    SELECT user_id, damage_total, first_reached_at,
           row_number() OVER (ORDER BY damage_total DESC, first_reached_at ASC) AS rnk
    FROM public.season_damage
    WHERE season_id = _season_id AND damage_total > 0
  LOOP
    reward := CASE r.rnk WHEN 1 THEN 100000 WHEN 2 THEN 50000 WHEN 3 THEN 25000 ELSE 0 END;

    INSERT INTO public.season_results(season_id, user_id, final_rank, final_damage, frame_tier, reward_gems)
    VALUES (_season_id, r.user_id, r.rnk, r.damage_total, public.season_frame_tier(r.damage_total), reward)
    ON CONFLICT (season_id, user_id) DO NOTHING;

    IF reward > 0 THEN
      -- Only grant if this insert actually created the row (i.e. wasn't already there)
      IF EXISTS (
        SELECT 1 FROM public.season_results
        WHERE season_id = _season_id AND user_id = r.user_id AND tx_id IS NULL AND reward_gems = reward
      ) THEN
        UPDATE public.profiles SET gems = COALESCE(gems,0) + reward WHERE id = r.user_id;
        WITH tx AS (
          INSERT INTO public.transactions(user_id, kind, amount, currency, meta)
          VALUES (r.user_id, 'season_reward', reward, 'gems',
                  jsonb_build_object('season_id', _season_id, 'rank', r.rnk, 'damage', r.damage_total))
          RETURNING id
        )
        UPDATE public.season_results
          SET tx_id = (SELECT id FROM tx), granted_at = now()
          WHERE season_id = _season_id AND user_id = r.user_id;
        rewarded := rewarded + 1;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.seasons SET status = 'closed', closed_at = now() WHERE id = _season_id;

  -- Open next season
  SELECT COALESCE(MAX(id),0) + 1 INTO next_num FROM public.seasons;
  INSERT INTO public.seasons(code, name, starts_at, ends_at, status)
  VALUES ('S' || lpad(next_num::text,2,'0'),
          'SEASON ' || lpad(next_num::text,2,'0'),
          now(), now() + interval '3 months', 'active');

  RETURN jsonb_build_object('ok', true, 'rewarded', rewarded);
END;
$$;
GRANT EXECUTE ON FUNCTION public.close_season(int) TO service_role;

-- 9) cron_close_expired_seasons
CREATE OR REPLACE FUNCTION public.cron_close_expired_seasons()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  closed_count int := 0;
  s record;
BEGIN
  FOR s IN SELECT id FROM public.seasons WHERE status = 'active' AND ends_at <= now() LOOP
    PERFORM public.close_season(s.id);
    closed_count := closed_count + 1;
  END LOOP;
  RETURN closed_count;
END;
$$;

-- 10) Bootstrap SEASON 01 now
SELECT public.current_season();

-- 11) pg_cron: hourly check
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('seasons-close-expired') WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'seasons-close-expired'
    );
    PERFORM cron.schedule(
      'seasons-close-expired',
      '17 * * * *',
      $cron$SELECT public.cron_close_expired_seasons();$cron$
    );
  END IF;
END $$;
