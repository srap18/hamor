CREATE OR REPLACE FUNCTION public.pause_golden_fisher()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _until timestamptz;
  _ship record;
  _harvested int := 0;
  _market_full boolean := false;
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

  -- Mark paused before harvesting. A concurrent tick taking the same lock can
  -- no longer relaunch ships between collection and the final dock update.
  UPDATE public.profiles
     SET golden_fisher_paused = true
   WHERE id = _uid;

  FOR _ship IN
    SELECT id
      FROM public.ships_owned
     WHERE user_id = _uid
       AND COALESCE(in_storage, false) = false
       AND COALESCE(at_sea, false) = true
       AND fishing_started_at IS NOT NULL
       AND stealing_target_user_id IS NULL
       AND stealing_ends_at IS NULL
     ORDER BY id
  LOOP
    BEGIN
      PERFORM 1 FROM public.collect_fishing_reward(_ship.id, NULL::text, NULL::integer);
      _harvested := _harvested + 1;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ILIKE '%market_full%' THEN
        _market_full := true;
      ELSIF SQLERRM NOT ILIKE '%not_fishing%' THEN
        INSERT INTO public.golden_fisher_errors(user_id, ship_id, cycles, fish_added, remaining_storage, exec_ms, error)
        VALUES (_uid, _ship.id, 0, 0, public.user_market_remaining(_uid), 0, SQLERRM);
      END IF;
    END;
  END LOOP;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         last_fishing_reward_at = NULL
   WHERE user_id = _uid
     AND COALESCE(in_storage, false) = false
     AND stealing_target_user_id IS NULL
     AND stealing_ends_at IS NULL
     AND (COALESCE(at_sea, false) OR fishing_started_at IS NOT NULL OR last_fishing_reward_at IS NOT NULL);

  RETURN jsonb_build_object('ok', true, 'paused', true, 'until', _until, 'harvested', _harvested, 'market_full', _market_full);
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_golden_fisher()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ship record;
  _harvested int := 0;
  _market_full boolean := false;
  _vip6 boolean := false;
  _lock_key bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  _lock_key := hashtextextended('golden_fisher:' || _uid::text, 0);
  PERFORM pg_advisory_xact_lock(_lock_key);
  _vip6 := public.elite_vip6_active(_uid);

  -- Block any later tick before settling and docking the fleet.
  UPDATE public.profiles
     SET golden_fisher_paused = true
   WHERE id = _uid;

  FOR _ship IN
    SELECT id
      FROM public.ships_owned
     WHERE user_id = _uid
       AND COALESCE(in_storage, false) = false
       AND COALESCE(at_sea, false) = true
       AND fishing_started_at IS NOT NULL
       AND stealing_target_user_id IS NULL
       AND stealing_ends_at IS NULL
     ORDER BY id
  LOOP
    BEGIN
      PERFORM 1 FROM public.collect_fishing_reward(_ship.id, NULL::text, NULL::integer);
      _harvested := _harvested + 1;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM ILIKE '%market_full%' THEN
        _market_full := true;
      ELSIF SQLERRM NOT ILIKE '%not_fishing%' THEN
        INSERT INTO public.golden_fisher_errors(user_id, ship_id, cycles, fish_added, remaining_storage, exec_ms, error)
        VALUES (_uid, _ship.id, 0, 0, public.user_market_remaining(_uid), 0, SQLERRM);
      END IF;
    END;
  END LOOP;

  IF _vip6 THEN
    UPDATE public.profiles p
       SET golden_fisher_paused = true,
           golden_fisher_until = GREATEST(
             COALESCE(p.golden_fisher_until, '-infinity'::timestamptz),
             COALESCE(p.elite_vip_expires_at, 'infinity'::timestamptz)
           )
     WHERE p.id = _uid;
  ELSE
    UPDATE public.profiles
       SET golden_fisher_until = NULL,
           golden_fisher_last_activated_at = NULL,
           golden_fisher_paused = false,
           golden_fisher_no_shield = false
     WHERE id = _uid;
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         last_fishing_reward_at = NULL
   WHERE user_id = _uid
     AND COALESCE(in_storage, false) = false
     AND stealing_target_user_id IS NULL
     AND stealing_ends_at IS NULL
     AND (COALESCE(at_sea, false) OR fishing_started_at IS NOT NULL OR last_fishing_reward_at IS NOT NULL);

  RETURN jsonb_build_object('ok', true, 'harvested', _harvested, 'market_full', _market_full, 'vip6_paused', _vip6);
END;
$function$;

REVOKE ALL ON FUNCTION public.pause_golden_fisher() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resume_golden_fisher() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pause_golden_fisher() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resume_golden_fisher() TO authenticated, service_role;

-- Repair currently affected active/paused Golden Fisher fleets. Set the caller
-- identity locally so the canonical collection function performs all normal
-- capacity, fish-pool, stock, competition, and audit logic.
DO $repair$
DECLARE
  _u record;
  _s record;
  _previous_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  FOR _u IN
    SELECT p.id
      FROM public.profiles p
     WHERE COALESCE(p.golden_fisher_paused, false) = true
       AND public.golden_fisher_active_until(p.id) > now()
       AND EXISTS (
         SELECT 1 FROM public.ships_owned s
          WHERE s.user_id = p.id
            AND COALESCE(s.in_storage, false) = false
            AND COALESCE(s.at_sea, false) = true
            AND s.fishing_started_at IS NOT NULL
            AND s.stealing_target_user_id IS NULL
            AND s.stealing_ends_at IS NULL
       )
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('golden_fisher:' || _u.id::text, 0));
    PERFORM set_config('request.jwt.claim.sub', _u.id::text, true);

    FOR _s IN
      SELECT id FROM public.ships_owned
       WHERE user_id = _u.id
         AND COALESCE(in_storage, false) = false
         AND COALESCE(at_sea, false) = true
         AND fishing_started_at IS NOT NULL
         AND stealing_target_user_id IS NULL
         AND stealing_ends_at IS NULL
       ORDER BY id
    LOOP
      BEGIN
        PERFORM 1 FROM public.collect_fishing_reward(_s.id, NULL::text, NULL::integer);
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT ILIKE '%market_full%'
           AND SQLERRM NOT ILIKE '%not_fishing%'
           AND SQLERRM NOT ILIKE '%ship_destroyed%' THEN
          INSERT INTO public.golden_fisher_errors(user_id, ship_id, cycles, fish_added, remaining_storage, exec_ms, error)
          VALUES (_u.id, _s.id, 0, 0, public.user_market_remaining(_u.id), 0, 'repair:' || SQLERRM);
        END IF;
      END;
    END LOOP;

    UPDATE public.ships_owned
       SET at_sea = false,
           fishing_started_at = NULL,
           last_fishing_reward_at = NULL
     WHERE user_id = _u.id
       AND COALESCE(in_storage, false) = false
       AND stealing_target_user_id IS NULL
       AND stealing_ends_at IS NULL
       AND (COALESCE(at_sea, false) OR fishing_started_at IS NOT NULL OR last_fishing_reward_at IS NOT NULL);
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub', COALESCE(_previous_sub, ''), true);
END;
$repair$;