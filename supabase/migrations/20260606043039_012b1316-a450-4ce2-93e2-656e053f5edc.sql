
-- 1) Weekly XP counter on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS weekly_xp INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_profiles_weekly_xp ON public.profiles(weekly_xp DESC);

-- 2) Trigger: mirror xp gains into weekly_xp
CREATE OR REPLACE FUNCTION public.track_weekly_xp()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.xp > OLD.xp THEN
    NEW.weekly_xp := COALESCE(OLD.weekly_xp, 0) + (NEW.xp - OLD.xp);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_track_weekly_xp ON public.profiles;
CREATE TRIGGER trg_track_weekly_xp
  BEFORE UPDATE OF xp ON public.profiles
  FOR EACH ROW
  WHEN (NEW.xp IS DISTINCT FROM OLD.xp)
  EXECUTE FUNCTION public.track_weekly_xp();

-- 3) Config table (singleton)
CREATE TABLE IF NOT EXISTS public.weekly_xp_config (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enabled BOOLEAN NOT NULL DEFAULT true,
  title TEXT NOT NULL DEFAULT 'مسابقة XP الأسبوعية',
  description TEXT NOT NULL DEFAULT 'تصدّر لوحة الـ XP خلال الأسبوع واحصل على جوائز فاخرة!',
  prize_tiers JSONB NOT NULL DEFAULT '[]'::jsonb,
  week_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_distributed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.weekly_xp_config TO anon, authenticated;
GRANT ALL ON public.weekly_xp_config TO service_role;
ALTER TABLE public.weekly_xp_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wxc_view ON public.weekly_xp_config;
CREATE POLICY wxc_view ON public.weekly_xp_config FOR SELECT USING (true);
DROP POLICY IF EXISTS wxc_admin ON public.weekly_xp_config;
CREATE POLICY wxc_admin ON public.weekly_xp_config FOR ALL
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

INSERT INTO public.weekly_xp_config (id, prize_tiers) VALUES (true, '[
  {"rank":1,"coins":100000,"gems":500,"xp":0,"text":""},
  {"rank":2,"coins":50000,"gems":250,"xp":0,"text":""},
  {"rank":3,"coins":25000,"gems":100,"xp":0,"text":""}
]'::jsonb) ON CONFLICT (id) DO NOTHING;

-- 4) History table
CREATE TABLE IF NOT EXISTS public.weekly_xp_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_started_at TIMESTAMPTZ NOT NULL,
  week_ended_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  winners JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.weekly_xp_history TO anon, authenticated;
GRANT ALL ON public.weekly_xp_history TO service_role;
ALTER TABLE public.weekly_xp_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wxh_view ON public.weekly_xp_history;
CREATE POLICY wxh_view ON public.weekly_xp_history FOR SELECT USING (true);
DROP POLICY IF EXISTS wxh_admin ON public.weekly_xp_history;
CREATE POLICY wxh_admin ON public.weekly_xp_history FOR ALL
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- 5) Leaderboard RPC
CREATE OR REPLACE FUNCTION public.get_weekly_xp_leaderboard(_limit INT DEFAULT 100)
RETURNS TABLE(
  user_id UUID,
  display_name TEXT,
  avatar_emoji TEXT,
  avatar_url TEXT,
  level INT,
  weekly_xp INT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id,
         COALESCE(display_name, username, '—') AS display_name,
         avatar_emoji,
         avatar_url,
         level,
         weekly_xp
    FROM public.profiles
   WHERE weekly_xp > 0
   ORDER BY weekly_xp DESC, level DESC
   LIMIT GREATEST(COALESCE(_limit, 100), 1)
$$;
GRANT EXECUTE ON FUNCTION public.get_weekly_xp_leaderboard(INT) TO anon, authenticated;

-- 6) Distribution function
CREATE OR REPLACE FUNCTION public.distribute_weekly_xp_prizes()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg public.weekly_xp_config%ROWTYPE;
  tier JSONB;
  winner RECORD;
  winners_log JSONB := '[]'::jsonb;
  v_rank INT := 0;
  v_coins BIGINT; v_gems INT; v_xp INT; v_text TEXT;
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NOT NULL AND NOT public.is_admin(v_caller) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT * INTO cfg FROM public.weekly_xp_config WHERE id = true FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','no_config');
  END IF;
  IF NOT cfg.enabled THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;

  FOR winner IN
    SELECT p.id,
           COALESCE(p.display_name, p.username, '—') AS name,
           p.weekly_xp
      FROM public.profiles p
     WHERE p.weekly_xp > 0
     ORDER BY p.weekly_xp DESC, p.level DESC
     LIMIT GREATEST(jsonb_array_length(COALESCE(cfg.prize_tiers, '[]'::jsonb)), 0)
  LOOP
    v_rank := v_rank + 1;
    tier := cfg.prize_tiers -> (v_rank - 1);
    EXIT WHEN tier IS NULL;

    v_coins := COALESCE((tier->>'coins')::bigint, 0);
    v_gems  := COALESCE((tier->>'gems')::int, 0);
    v_xp    := COALESCE((tier->>'xp')::int, 0);
    v_text  := COALESCE(tier->>'text', '');

    IF v_coins > 0 OR v_gems > 0 OR v_xp > 0 THEN
      UPDATE public.profiles
         SET coins = coins + v_coins,
             gems  = gems  + v_gems,
             xp    = xp    + v_xp
       WHERE id = winner.id;
    END IF;

    INSERT INTO public.notifications (recipient_id, title, body, kind, meta)
    VALUES (
      winner.id,
      '🏆 فزت في مسابقة XP الأسبوعية!',
      'مركزك #' || v_rank || ' — ' || winner.weekly_xp || ' XP هذا الأسبوع',
      'gift',
      jsonb_build_object(
        'source','weekly_xp',
        'rank', v_rank,
        'weekly_xp', winner.weekly_xp,
        'rewards', jsonb_build_object('coins',v_coins,'gems',v_gems,'xp',v_xp,'text',v_text)
      )
    );

    winners_log := winners_log || jsonb_build_array(jsonb_build_object(
      'rank', v_rank,
      'user_id', winner.id,
      'name', winner.name,
      'weekly_xp', winner.weekly_xp,
      'coins', v_coins,
      'gems', v_gems,
      'xp', v_xp,
      'text', v_text
    ));
  END LOOP;

  INSERT INTO public.weekly_xp_history (week_started_at, winners)
  VALUES (cfg.week_started_at, winners_log);

  UPDATE public.profiles SET weekly_xp = 0 WHERE weekly_xp > 0;
  UPDATE public.weekly_xp_config
     SET week_started_at = now(),
         last_distributed_at = now(),
         updated_at = now()
   WHERE id = true;

  RETURN jsonb_build_object('distributed', v_rank, 'winners', winners_log);
END $$;
GRANT EXECUTE ON FUNCTION public.distribute_weekly_xp_prizes() TO authenticated, service_role;

-- 7) Schedule weekly distribution (Monday 00:00 UTC)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('distribute-weekly-xp');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'distribute-weekly-xp',
  '0 0 * * 1',
  $cron$ SELECT public.distribute_weekly_xp_prizes(); $cron$
);
