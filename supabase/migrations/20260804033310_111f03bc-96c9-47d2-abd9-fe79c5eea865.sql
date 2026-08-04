DO $migration$
DECLARE
  _oid regprocedure := to_regprocedure('public.collect_fishing_reward(uuid,text,integer)');
  _def text;
  _old text := E'  IF _client_progress IS NOT NULL AND _client_progress >= 0 THEN\n    _base := LEAST(_base, _client_progress);\n    IF _base < 1 THEN _base := 1; END IF;\n  END IF;\n';
BEGIN
  IF _oid IS NULL THEN
    RAISE EXCEPTION 'collect_fishing_reward function not found';
  END IF;

  SELECT pg_get_functiondef(_oid::oid) INTO _def;
  IF position(_old IN _def) = 0 THEN
    RAISE EXCEPTION 'client progress clamp block not found';
  END IF;

  _def := replace(
    _def,
    _old,
    E'  -- Server elapsed time is authoritative. Client progress may be stale after\n  -- a mobile app resumes and must never reduce a legitimate catch.\n'
  );
  EXECUTE _def;
END
$migration$;

REVOKE ALL ON FUNCTION public.collect_fishing_reward(uuid, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collect_fishing_reward(uuid, text, integer) TO authenticated, service_role;