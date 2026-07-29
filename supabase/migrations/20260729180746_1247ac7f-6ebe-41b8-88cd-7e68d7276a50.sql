DO $mig$
DECLARE d text; d2 text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'collect_fishing_reward';

  d2 := replace(d,
    'AND c.metric = ''fish_specific''
        AND c.target_fish_id = _chosen',
    'AND c.metric IN (''fish_specific'', ''fish_total'')
        AND (c.metric = ''fish_total'' OR c.target_fish_id = _chosen)');

  IF d2 = d THEN
    RAISE EXCEPTION 'collect_fishing_reward competition block not found';
  END IF;

  EXECUTE d2;
END
$mig$;