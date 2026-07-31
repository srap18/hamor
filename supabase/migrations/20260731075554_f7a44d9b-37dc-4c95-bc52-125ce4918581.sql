DO $migration$
DECLARE
  _oid oid;
  _old text;
  _new text;
  _needle text := $snippet$
  UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL, stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL, stealing_started_at = NULL
   WHERE (stealing_target_user_id = _user OR (user_id = _user AND stealing_target_user_id IS NOT NULL))
     AND (at_sea IS DISTINCT FROM false
       OR fishing_started_at IS NOT NULL
       OR stealing_target_user_id IS NOT NULL
       OR stealing_target_ship_id IS NOT NULL
       OR stealing_ends_at IS NOT NULL
       OR stealing_started_at IS NOT NULL);
$snippet$;
BEGIN
  SELECT p.oid
    INTO _oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'golden_fisher_tick'
     AND pg_get_function_identity_arguments(p.oid) = '_user uuid';

  IF _oid IS NULL THEN
    RAISE EXCEPTION 'golden_fisher_tick(uuid) not found';
  END IF;

  _old := pg_get_functiondef(_oid);
  IF position(_needle IN _old) = 0 THEN
    RAISE EXCEPTION 'expected steal-cancellation block was not found';
  END IF;

  _new := replace(
    _old,
    _needle,
    E'\n  -- Active steal missions are independent from Golden Fisher.\n  -- Never dock or clear a raider merely because either player has Golden Fisher enabled.\n'
  );

  EXECUTE _new;
END;
$migration$;