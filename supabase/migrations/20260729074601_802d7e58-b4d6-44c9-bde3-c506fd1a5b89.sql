CREATE OR REPLACE FUNCTION public._auto_route_new_ship()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _active_count int;
  _storage_count int;
  _storage_cap int;
  _allow_reward_overflow boolean := false;
BEGIN
  _allow_reward_overflow := COALESCE(current_setting('app.allow_reward_ship_storage_overflow', true), '') = 'true';

  SELECT
    COUNT(*) FILTER (WHERE NOT in_storage),
    COUNT(*) FILTER (WHERE in_storage)
  INTO _active_count, _storage_count
  FROM public.ships_owned WHERE user_id = NEW.user_id;

  SELECT GREATEST(3, LEAST(20, COALESCE(storage_capacity, 3)))
    INTO _storage_cap
    FROM public.profiles WHERE id = NEW.user_id;
  IF _storage_cap IS NULL THEN _storage_cap := 3; END IF;

  IF NEW.in_storage = false AND _active_count >= 3 THEN
    IF _storage_count >= _storage_cap AND NOT _allow_reward_overflow THEN
      RAISE EXCEPTION 'fleet and storage full';
    END IF;
    NEW.in_storage := true;
  ELSIF NEW.in_storage = true AND _storage_count >= _storage_cap AND NOT _allow_reward_overflow THEN
    RAISE EXCEPTION 'storage full';
  END IF;
  RETURN NEW;
END;
$function$;