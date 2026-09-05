DO $$
DECLARE d text; nd text; old_s text; new_s text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='collect_fishing_reward';

  old_s := '        AND now() BETWEEN c.starts_at AND c.ends_at
    );';
  new_s := '        AND now() BETWEEN c.starts_at AND c.ends_at
    ) OR EXISTS (
      SELECT 1 FROM public.tribe_fish_events e
      WHERE e.active = true
        AND COALESCE(e.metric, ''fish'') NOT IN (''gold'', ''damage'', ''destroy'')
        AND now() BETWEEN e.starts_at AND e.ends_at
    );';

  nd := replace(d, old_s, new_s);
  IF nd = d THEN RAISE EXCEPTION 'patch anchor not found'; END IF;
  EXECUTE nd;
END $$;

INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty, source)
SELECT fs.user_id, fs.fish_id, fs.caught_at, GREATEST(COALESCE(fs.quantity,1),1), 'catch'
FROM public.fish_stock fs
JOIN public.tribe_fish_events e
  ON e.active = true
 AND COALESCE(e.metric,'fish') NOT IN ('gold','damage','destroy')
 AND e.ends_at > now()
 AND fs.caught_at >= e.starts_at
WHERE NOT EXISTS (
  SELECT 1 FROM public.competition_catches cc
  WHERE cc.user_id = fs.user_id AND cc.fish_id = fs.fish_id AND cc.caught_at = fs.caught_at
);