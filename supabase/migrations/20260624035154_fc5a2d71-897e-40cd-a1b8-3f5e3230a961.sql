SET lock_timeout = '30s';
UPDATE public.competition_catches cc
   SET tribe_id = p.tribe_id
  FROM public.profiles p
 WHERE cc.user_id = p.id
   AND cc.tribe_id IS NULL
   AND p.tribe_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_competition_catches_tribe_caught_at
  ON public.competition_catches (tribe_id, caught_at);