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
  _tick jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT golden_fisher_until
    INTO _current
  FROM public.profiles
  WHERE id = _uid
  FOR UPDATE;

  -- If still active, do not consume another item.
  IF _current IS NOT NULL AND _current > now() THEN
    _tick := public.golden_fisher_tick(_uid);
    RETURN jsonb_build_object('ok', true, 'already_active', true, 'until', _current, 'tick', _tick);
  END IF;

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

  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'no_golden_fisher_in_inventory';
  END IF;

  IF _row.quantity <= 1 THEN
    DELETE FROM public.inventory WHERE id = _row.id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
  END IF;

  _new_until := now() + interval '24 hours';

  UPDATE public.profiles
     SET golden_fisher_until = _new_until,
         golden_fisher_last_activated_at = now(),
         protection_until = GREATEST(COALESCE(protection_until, _new_until), _new_until)
   WHERE id = _uid;

  UPDATE public.ships_owned
     SET fishing_started_at = COALESCE(fishing_started_at, now()),
         at_sea = true
   WHERE user_id = _uid
     AND in_storage = false
     AND destroyed_at IS NULL
     AND (repair_ends_at IS NULL OR repair_ends_at <= now())
     AND stealing_target_user_id IS NULL
     AND stealing_ends_at IS NULL;

  _tick := public.golden_fisher_tick(_uid);

  RETURN jsonb_build_object('ok', true, 'already_active', false, 'until', _new_until, 'tick', _tick);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.activate_golden_fisher() TO authenticated;