DO $migration$
DECLARE
  _oid regprocedure := to_regprocedure('public.golden_fisher_tick(uuid)');
  _def text;
BEGIN
  IF _oid IS NULL THEN RAISE EXCEPTION 'golden_fisher_tick not found'; END IF;
  SELECT pg_get_functiondef(_oid::oid) INTO _def;

  IF position('_cycles := LEAST(1, FLOOR(_elapsed / _duration)::int);' IN _def) = 0 THEN
    RAISE EXCEPTION 'golden cycle cap block not found';
  END IF;
  IF position('_new_last_at := _now;' IN _def) = 0 THEN
    RAISE EXCEPTION 'golden timestamp reset block not found';
  END IF;
  IF position('_qty := LEAST(_capacity * _luck_mult::bigint, GREATEST(0, _market_remaining));' IN _def) = 0 THEN
    RAISE EXCEPTION 'golden quantity block not found';
  END IF;

  _def := replace(
    _def,
    '_cycles := LEAST(1, FLOOR(_elapsed / _duration)::int);',
    '_cycles := GREATEST(0, FLOOR(_elapsed / _duration)::int);'
  );
  _def := replace(
    _def,
    '_new_last_at := _now;',
    E'-- Preserve the unfinished fraction of the current cycle instead of\n        -- resetting all elapsed time to now().\n        _new_last_at := _now - make_interval(secs => MOD(_elapsed, _duration)::double precision);'
  );
  _def := replace(
    _def,
    '_qty := LEAST(_capacity * _luck_mult::bigint, GREATEST(0, _market_remaining));',
    E'-- Pay every newly recorded completed cycle, bounded by shared market capacity.\n        _qty := LEAST(_capacity * _luck_mult::bigint * _inserted_slots::bigint, GREATEST(0, _market_remaining));'
  );

  EXECUTE _def;
END
$migration$;

REVOKE ALL ON FUNCTION public.golden_fisher_tick(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) TO authenticated, service_role;