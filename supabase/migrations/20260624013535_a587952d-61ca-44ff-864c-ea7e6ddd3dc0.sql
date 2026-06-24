
CREATE TABLE public.arena_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled boolean NOT NULL DEFAULT true,
  locked_title text NOT NULL DEFAULT '🔒 الأرينا مقفلة مؤقتاً',
  locked_message text NOT NULL DEFAULT 'سنفتحها قريباً بتحديث جديد. ترقّبوا!',
  rewards jsonb NOT NULL DEFAULT '[
    {"rank":"🥇 #1","text":"قطعة أسطورية مضمونة + 100,000 🪙"},
    {"rank":"🥈 #2-3","text":"قطعة ملحمية مضمونة + 50,000 🪙"},
    {"rank":"🥉 #4-10","text":"قطعة نادرة مضمونة + 20,000 🪙"},
    {"rank":"#11-25","text":"قطعة عادية + 5,000 🪙"}
  ]'::jsonb,
  event_active boolean NOT NULL DEFAULT false,
  event_title text,
  event_multiplier numeric NOT NULL DEFAULT 1 CHECK (event_multiplier >= 1 AND event_multiplier <= 10),
  event_ends_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.arena_settings TO anon, authenticated;
GRANT ALL  ON public.arena_settings TO service_role;

ALTER TABLE public.arena_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "arena_settings_read_all" ON public.arena_settings
  FOR SELECT USING (true);

CREATE POLICY "arena_settings_admin_write" ON public.arena_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.arena_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Honor settings (enabled flag + event multiplier) in score awarding.
CREATE OR REPLACE FUNCTION public.award_arena_score(p_score bigint, p_won boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_week date := date_trunc('week', now())::date;
  v_capped bigint;
  v_settings public.arena_settings%ROWTYPE;
  v_mult numeric := 1;
BEGIN
  IF v_user IS NULL OR p_score <= 0 THEN RETURN; END IF;

  SELECT * INTO v_settings FROM public.arena_settings WHERE id = true;
  IF v_settings.id IS NOT NULL AND v_settings.enabled = false THEN
    RETURN;
  END IF;

  IF v_settings.event_active
     AND (v_settings.event_ends_at IS NULL OR v_settings.event_ends_at > now()) THEN
    v_mult := COALESCE(v_settings.event_multiplier, 1);
  END IF;

  v_capped := LEAST(p_score, 5000);
  v_capped := GREATEST(1, (v_capped * v_mult)::bigint);

  INSERT INTO arena_scores(user_id, week_start, score, wins, updated_at)
  VALUES (v_user, v_week, v_capped, CASE WHEN p_won THEN 1 ELSE 0 END, now())
  ON CONFLICT (user_id, week_start) DO UPDATE SET
    score = arena_scores.score + EXCLUDED.score,
    wins  = arena_scores.wins  + EXCLUDED.wins,
    updated_at = now();
END $function$;
