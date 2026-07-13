CREATE OR REPLACE FUNCTION public.ship_to_storage(p_ship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _storage_count int;
  _storage_capacity int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _row
  FROM public.ships_owned
  WHERE id = p_ship_id AND user_id = _uid
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _row.in_storage THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already_stored');
  END IF;
  IF _row.stealing_target_user_id IS NOT NULL THEN RAISE EXCEPTION 'ship on mission'; END IF;
  IF _row.destroyed_at IS NOT NULL
     AND _row.repair_ends_at IS NOT NULL
     AND _row.repair_ends_at > now() THEN
    RAISE EXCEPTION 'ship under repair';
  END IF;

  SELECT COALESCE(storage_capacity, 3)
  INTO _storage_capacity
  FROM public.profiles
  WHERE id = _uid
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'profile not found'; END IF;

  SELECT COUNT(*) INTO _storage_count
  FROM public.ships_owned
  WHERE user_id = _uid AND in_storage = true;

  IF _storage_count >= _storage_capacity THEN
    RAISE EXCEPTION 'storage full';
  END IF;

  -- Auto-dock if at sea (forfeit any active fishing trip)
  UPDATE public.ships_owned
  SET in_storage = true,
      at_sea = false,
      departed_at = NULL,
      arrives_at = NULL
  WHERE id = p_ship_id;

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'stored',
    'stored_count', _storage_count + 1,
    'storage_capacity', _storage_capacity
  );
END
$function$;