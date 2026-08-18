CREATE OR REPLACE FUNCTION public.resume_golden_fisher()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _until timestamptz;
  _tick jsonb;
  _lock_key bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  _lock_key := hashtextextended('golden_fisher:' || _uid::text, 0);
  PERFORM pg_advisory_xact_lock(_lock_key);

  SELECT public.golden_fisher_active_until(_uid)
    INTO _until
    FROM public.profiles
   WHERE id = _uid
   FOR UPDATE;

  IF _until IS NULL OR _until <= now() THEN
    RAISE EXCEPTION 'golden_fisher_not_active';
  END IF;

  UPDATE public.profiles
     SET golden_fisher_paused = false,
         golden_fisher_until = CASE
           WHEN public.elite_vip6_active(_uid)
             THEN GREATEST(
               COALESCE(golden_fisher_until, '-infinity'::timestamptz),
               COALESCE(elite_vip_expires_at, 'infinity'::timestamptz)
             )
           ELSE golden_fisher_until
         END
   WHERE id = _uid;

  _tick := public.golden_fisher_tick(_uid);

  RETURN jsonb_build_object('ok', true, 'paused', false, 'until', _until, 'tick', _tick);
END;
$function$;

REVOKE ALL ON FUNCTION public.resume_golden_fisher() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resume_golden_fisher() TO authenticated, service_role;

UPDATE public.ships_owned s
   SET at_sea = false,
       fishing_started_at = NULL,
       last_fishing_reward_at = NULL
  FROM public.profiles p
 WHERE p.id = s.user_id
   AND COALESCE(p.golden_fisher_paused, false) = true
   AND COALESCE(s.in_storage, false) = false
   AND s.stealing_target_user_id IS NULL
   AND s.stealing_ends_at IS NULL
   AND (COALESCE(s.at_sea, false) OR s.fishing_started_at IS NOT NULL OR s.last_fishing_reward_at IS NOT NULL);