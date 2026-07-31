CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer, _skip_fishing_check boolean DEFAULT false)
 RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _owner uuid; _tpl int; _repair_secs int;
  _resulting_hp int; _resulting_repair timestamptz;
  _prot timestamptz; _attacker uuid := auth.uid();
  _prev_hp int;
  _req_error text;
  _in_storage boolean;
  _destroyed_at timestamptz;
  _target_market int;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  PERFORM public._prep_pvp_checks(_attacker);

  SELECT s.user_id, s.template_id, COALESCE(s.hp, 100),
         COALESCE(s.in_storage, false), s.destroyed_at
    INTO _owner, _tpl, _prev_hp, _in_storage, _destroyed_at
    FROM public.ships_owned s WHERE s.id = _ship_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = _attacker THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  IF _destroyed_at IS NOT NULL OR _prev_hp <= 0 THEN RAISE EXCEPTION 'ship already destroyed'; END IF;
  IF _in_storage THEN RAISE EXCEPTION 'ship in storage'; END IF;

  PERFORM public._prep_pvp_checks(_owner);

  IF NOT public.is_admin(_attacker) THEN
    _req_error := public.pvp_attacker_requirement_error(_attacker);
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;

    IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;

    _target_market := public.effective_market_level(_owner);
    IF _target_market < 6 THEN
      RAISE EXCEPTION 'target is protected (market level under 6: current=%)', _target_market;
    END IF;

    _req_error := public.pvp_level_gap_error(_attacker, _owner);
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
  END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _owner;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles
     SET protection_until = NULL, shield_cooldown_until = now() + interval '2 minutes'
   WHERE id = _attacker AND protection_until IS NOT NULL;

  _repair_secs := public._ship_repair_seconds(_tpl);
  _resulting_hp := GREATEST(0, _prev_hp - GREATEST(0, _damage));
  IF _resulting_hp <= 0 THEN
    _resulting_repair := now() + make_interval(secs => _repair_secs);
    UPDATE public.ships_owned
       SET hp = 0, destroyed_at = now(), repair_ends_at = _resulting_repair,
           at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
     WHERE id = _ship_id;
    -- Crew timers are NEVER modified by combat: destroying a ship must not
    -- extend, recalculate, or pause any crew expiry.
    RETURN QUERY SELECT 0, true, _resulting_repair;
  ELSE
    UPDATE public.ships_owned
       SET hp = _resulting_hp,
           destroyed_at = NULL,
           repair_ends_at = NULL
     WHERE id = _ship_id;
    RETURN QUERY SELECT _resulting_hp, false, NULL::timestamptz;
  END IF;
END;
$function$;