CREATE OR REPLACE FUNCTION public.golden_fisher_tick_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _u record;
  _res jsonb;
  _users int := 0;
  _cycles int := 0;
  _ships int := 0;
  _launched int := 0;
  _fish_added bigint := 0;
  _waiting int := 0;
BEGIN
  -- Housekeeping only: run the expired-crew sweep once per minute instead of
  -- every 5s tick. Player-visible behaviour is unchanged (crews expire by
  -- timestamp, this only removes already-expired unassigned rows).
  IF EXTRACT(SECOND FROM now())::int < 5 THEN
    PERFORM public.sweep_expired_crews();
  END IF;

  FOR _u IN
    SELECT DISTINCT id
    FROM (
      SELECT p.id
        FROM public.profiles p
       WHERE p.golden_fisher_until IS NOT NULL AND p.golden_fisher_until > now()
      UNION
      SELECT i.user_id AS id
        FROM public.inventory i
       WHERE i.item_type = 'crew'
         AND i.item_id = 'golden_fisher'
         AND i.meta ? 'expires_at'
         AND (i.meta->>'expires_at')::timestamptz > now()
    ) active_users
  LOOP
    _res := public.golden_fisher_tick(_u.id);
    _users := _users + 1;
    _cycles := _cycles + COALESCE((_res->>'cycles')::int, 0);
    _ships := _ships + COALESCE((_res->>'ships')::int, 0);
    _launched := _launched + COALESCE((_res->>'launched')::int, 0);
    _fish_added := _fish_added + COALESCE((_res->>'fish_added')::bigint, 0);
    _waiting := _waiting + COALESCE((_res->>'waiting_for_space')::int, 0);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'users', _users,
    'cycles', _cycles,
    'ships', _ships,
    'launched', _launched,
    'fish_added', _fish_added,
    'waiting_for_space', _waiting
  );
END;
$fn$;