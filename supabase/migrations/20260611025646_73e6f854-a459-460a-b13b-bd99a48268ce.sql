CREATE OR REPLACE FUNCTION public.remove_golden_fisher()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Only clear the active state and the daily cap so the user can re-activate.
  -- DO NOT delete the inventory stack: activation already consumed one,
  -- the rest must remain available in storage.
  UPDATE public.profiles
     SET golden_fisher_until = NULL,
         golden_fisher_last_activated_at = NULL
   WHERE id = _uid;

  RETURN jsonb_build_object('ok', true);
END;
$function$;