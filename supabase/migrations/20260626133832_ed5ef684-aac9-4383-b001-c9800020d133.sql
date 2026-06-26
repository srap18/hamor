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
  _is_admin boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT public.has_role(_uid, 'admin'::public.app_role) INTO _is_admin;
  _is_admin := COALESCE(_is_admin, false);

  SELECT golden_fisher_until INTO _current
    FROM public.profiles WHERE id = _uid FOR UPDATE;

  SELECT * INTO _row
    FROM public.inventory
   WHERE user_id = _uid
     AND item_type = 'crew'
     AND item_id = 'golden_fisher'
     AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL)
     AND quantity > 0
   ORDER BY acquired_at ASC
   FOR UPDATE
   LIMIT 1;

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
    IF _is_admin THEN
      _base := GREATEST(COALESCE(_current, now()), now());
      _new_until := _base + interval '24 hours';
    ELSIF _current IS NULL OR _current <= now() THEN
      RAISE EXCEPTION 'no_golden_fisher_in_inventory';
    ELSE
      _new_until := _current;
    END IF;
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
    'admin_test', (_is_admin AND NOT _had_inventory),
    'until', _new_until,
    'tick', _tick
  );
END;
$function$;