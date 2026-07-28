
-- 1) Explicit engagement state table
CREATE TABLE IF NOT EXISTS public.pvp_engagements (
  user_a uuid NOT NULL,
  user_b uuid NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  last_attack_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

GRANT SELECT ON public.pvp_engagements TO authenticated;
GRANT ALL ON public.pvp_engagements TO service_role;

ALTER TABLE public.pvp_engagements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "engagements_read_own" ON public.pvp_engagements;
CREATE POLICY "engagements_read_own" ON public.pvp_engagements
  FOR SELECT TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b);

CREATE INDEX IF NOT EXISTS pvp_engagements_expires_idx
  ON public.pvp_engagements (expires_at);
CREATE INDEX IF NOT EXISTS pvp_engagements_user_b_idx
  ON public.pvp_engagements (user_b);

-- 2) Helper to open/refresh engagement (canonical order, bidirectional)
CREATE OR REPLACE FUNCTION public.open_pvp_engagement(_x uuid, _y uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE _a uuid; _b uuid;
BEGIN
  IF _x IS NULL OR _y IS NULL OR _x = _y THEN RETURN; END IF;
  IF _x < _y THEN _a := _x; _b := _y; ELSE _a := _y; _b := _x; END IF;

  INSERT INTO public.pvp_engagements(user_a, user_b, opened_at, last_attack_at, expires_at)
  VALUES (_a, _b, now(), now(), now() + interval '30 minutes')
  ON CONFLICT (user_a, user_b) DO UPDATE
    SET last_attack_at = now(),
        expires_at = now() + interval '30 minutes';
END $$;

-- 3) Read helper: is there an active engagement between two players?
CREATE OR REPLACE FUNCTION public.pvp_engaged(_x uuid, _y uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pvp_engagements e
    WHERE ((e.user_a = LEAST(_x,_y) AND e.user_b = GREATEST(_x,_y)))
      AND e.expires_at > now()
  )
$$;

-- 4) Trigger on attacks: any recorded attack opens engagement between the two parties
CREATE OR REPLACE FUNCTION public._trg_open_engagement_on_attack()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
BEGIN
  IF NEW.attacker_id IS NOT NULL AND NEW.defender_id IS NOT NULL
     AND NEW.attacker_id <> NEW.defender_id THEN
    PERFORM public.open_pvp_engagement(NEW.attacker_id, NEW.defender_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_open_engagement_on_attack ON public.attacks;
CREATE TRIGGER trg_open_engagement_on_attack
  AFTER INSERT ON public.attacks
  FOR EACH ROW EXECUTE FUNCTION public._trg_open_engagement_on_attack();

-- 5) Rewrite pvp_level_gap_error: use explicit engagement state, not a 30-min attacks scan
CREATE OR REPLACE FUNCTION public.pvp_level_gap_error(_attacker uuid, _defender uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  _a_max int; _d_max int; _gap int;
  _a_mkt int; _d_mkt int;
BEGIN
  IF _attacker IS NULL OR _defender IS NULL THEN RETURN NULL; END IF;
  IF public.is_admin(_attacker) THEN RETURN NULL; END IF;

  -- Explicit engagement: if an actual attack has already been recorded between
  -- these two parties (regardless of how it was allowed), PvP is open both ways
  -- until the engagement expires. Ensures the defender can always retaliate.
  IF public.pvp_engaged(_attacker, _defender) THEN RETURN NULL; END IF;

  _a_max := public.pvp_max_ship_level(_attacker);
  _d_max := public.pvp_max_ship_level(_defender);
  _a_mkt := public.effective_market_level(_attacker);
  _d_mkt := public.effective_market_level(_defender);
  _gap := ABS(COALESCE(_a_max, 0) - COALESCE(_d_max, 0));

  IF _gap < 15 THEN RETURN NULL; END IF;

  -- Level-20 shipyard exception: lower side, at market level 20+, loses gap protection.
  IF _a_max >= _d_max THEN
    IF COALESCE(_d_mkt, 0) >= 20 THEN RETURN NULL; END IF;
  ELSE
    IF COALESCE(_a_mkt, 0) >= 20 THEN RETURN NULL; END IF;
  END IF;

  RETURN '🛡️ هذا اللاعب محمي منك بسبب فرق المستوى.' || E'\n'
      || 'أعلى سفينة لديك: المستوى ' || COALESCE(_a_max,0)::text || E'\n'
      || 'أعلى سفينة لديه: المستوى ' || COALESCE(_d_max,0)::text || E'\n'
      || 'فرق المستوى: ' || _gap::text || E'\n\n'
      || 'لا يمكنك مهاجمته حالياً بسبب نظام حماية فرق المستوى (15 أو أكثر). '
      || 'يزول هذا الحاجز عندما يصل الطرف الأقل إلى مستوى سوق السفن 20.';
END $$;

-- 6) Backfill engagements from any recent attacks so nobody loses retaliation window
INSERT INTO public.pvp_engagements(user_a, user_b, opened_at, last_attack_at, expires_at)
SELECT LEAST(a.attacker_id, a.defender_id),
       GREATEST(a.attacker_id, a.defender_id),
       MIN(a.created_at),
       MAX(a.created_at),
       MAX(a.created_at) + interval '30 minutes'
FROM public.attacks a
WHERE a.attacker_id IS NOT NULL
  AND a.defender_id IS NOT NULL
  AND a.attacker_id <> a.defender_id
  AND a.created_at > now() - interval '30 minutes'
GROUP BY LEAST(a.attacker_id, a.defender_id), GREATEST(a.attacker_id, a.defender_id)
ON CONFLICT (user_a, user_b) DO UPDATE
  SET last_attack_at = GREATEST(public.pvp_engagements.last_attack_at, EXCLUDED.last_attack_at),
      expires_at    = GREATEST(public.pvp_engagements.expires_at,    EXCLUDED.expires_at);
