CREATE OR REPLACE FUNCTION public.activate_golden_fisher()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _current timestamptz;
  _new_until timestamptz;
  _base timestamptz;
  _had_inventory boolean := false;
  _tick jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  IF NOT public.is_admin(_uid) THEN
    RAISE EXCEPTION 'golden_fisher_temporarily_disabled';
  END IF;

  SELECT golden_fisher_until INTO _current FROM public.profiles WHERE id = _uid FOR UPDATE;

  SELECT * INTO _row
  FROM public.inventory
  WHERE user_id = _uid AND item_type = 'crew' AND item_id = 'golden_fisher'
    AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL)
    AND quantity > 0
  ORDER BY acquired_at ASC FOR UPDATE LIMIT 1;

  IF _row.id IS NOT NULL THEN
    _had_inventory := true;
    IF _row.quantity <= 1 THEN
      DELETE FROM public.inventory WHERE id = _row.id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    END IF;
    _base := GREATEST(COALESCE(_current, now()), now());
    _new_until := _base + interval '24 hours';
  ELSE
    IF _current IS NULL OR _current <= now() THEN
      RAISE EXCEPTION 'no_golden_fisher_in_inventory';
    END IF;
    _new_until := _current;
  END IF;

  UPDATE public.profiles
     SET golden_fisher_until = _new_until,
         golden_fisher_last_activated_at = now(),
         protection_until = GREATEST(COALESCE(protection_until, _new_until), _new_until)
   WHERE id = _uid;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_ends_at = NULL,
         stealing_started_at = NULL
   WHERE stealing_target_user_id = _uid;

  UPDATE public.ships_owned s
     SET at_sea = true,
         fishing_started_at = (now() - (GREATEST(60, COALESCE(c.fishing_seconds, 600)) || ' seconds')::interval)
    FROM public.ship_catalog c
   WHERE c.code = s.catalog_code
     AND s.user_id = _uid
     AND s.in_storage = false
     AND s.destroyed_at IS NULL
     AND (s.repair_ends_at IS NULL OR s.repair_ends_at <= now())
     AND s.stealing_target_user_id IS NULL
     AND s.stealing_ends_at IS NULL;

  _tick := public.golden_fisher_tick(_uid);

  RETURN jsonb_build_object(
    'ok', true,
    'already_active', (_current IS NOT NULL AND _current > now() AND NOT _had_inventory),
    'extended', _had_inventory,
    'until', _new_until,
    'tick', _tick
  );
END;
$function$;

DO $patch$
DECLARE
  _src text;
  _new text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _src
  FROM pg_proc WHERE proname='send_support' AND pronamespace='public'::regnamespace;
  IF _src IS NULL THEN RETURN; END IF;
  IF position('golden_fisher_temporarily_disabled' in _src) > 0 THEN RETURN; END IF;

  _new := replace(
    _src,
    E'IF _kind NOT IN (\'repair\',\'crew\') THEN RAISE EXCEPTION \'bad kind\'; END IF;',
    E'IF _kind NOT IN (\'repair\',\'crew\') THEN RAISE EXCEPTION \'bad kind\'; END IF;\n  IF _kind = \'crew\' AND _crew_id = \'golden_fisher\' AND NOT public.is_admin(_me) THEN\n    RAISE EXCEPTION \'golden_fisher_temporarily_disabled\';\n  END IF;'
  );
  EXECUTE _new;
END $patch$;