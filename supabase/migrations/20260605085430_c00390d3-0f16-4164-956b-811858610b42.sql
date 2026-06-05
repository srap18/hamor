DROP FUNCTION IF EXISTS public.apply_ship_damage(uuid, integer);
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer, _skip_fishing_check boolean DEFAULT false)
 RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _owner uuid;
  _tpl int;
  _repair_secs int;
  _resulting_hp int;
  _resulting_repair timestamptz;
  _prot timestamptz;
  _attacker uuid := auth.uid();
  _prev_hp int;
  _dmg_dealt int;
  _xp_gain int;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT s.user_id, s.template_id, COALESCE(s.hp, 100) INTO _owner, _tpl, _prev_hp
    FROM public.ships_owned s WHERE s.id = _ship_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = _attacker THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN
    RAISE EXCEPTION 'attacker market level under 6';
  END IF;

  IF NOT public.has_pvp_fleet(_attacker) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;

  IF NOT _skip_fishing_check AND NOT public.has_fishing_ship(_attacker) THEN
    RAISE EXCEPTION 'attacker needs fishing ship: send a ship to fish first';
  END IF;

  IF NOT public.is_market_pvp_unlocked(_owner) THEN
    RAISE EXCEPTION 'target is protected (market level under 6)';
  END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _owner;
  IF _prot IS NOT NULL AND _prot > now() THEN
    RAISE EXCEPTION 'target is protected';
  END IF;

  _tpl := COALESCE(_tpl, 1);
  _repair_secs := LEAST(259200, GREATEST(14400, _tpl * _tpl * 600));

  UPDATE public.ships_owned AS s
     SET hp = s.max_hp, destroyed_at = NULL, repair_ends_at = NULL
   WHERE s.id = _ship_id
     AND s.destroyed_at IS NOT NULL
     AND s.repair_ends_at IS NOT NULL
     AND s.repair_ends_at <= now();

  SELECT COALESCE(hp, 100) INTO _prev_hp FROM public.ships_owned WHERE id = _ship_id;

  UPDATE public.ships_owned AS s
    SET hp = GREATEST(0, COALESCE(s.hp, 100) - _damage),
        destroyed_at = CASE
          WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 AND s.destroyed_at IS NULL
          THEN now() ELSE s.destroyed_at END,
        repair_ends_at = CASE
          WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 AND s.repair_ends_at IS NULL
          THEN now() + make_interval(secs => _repair_secs) ELSE s.repair_ends_at END
  WHERE s.id = _ship_id
  RETURNING s.hp, s.repair_ends_at INTO _resulting_hp, _resulting_repair;

  _dmg_dealt := GREATEST(0, _prev_hp - COALESCE(_resulting_hp, 0));
  IF _dmg_dealt > 0 THEN
    _xp_gain := LEAST(500, GREATEST(1, _dmg_dealt / 10));
    PERFORM public._mutate_currency(_attacker, 0, 0, 0, _xp_gain);
  END IF;

  new_hp := _resulting_hp;
  destroyed := _resulting_hp = 0;
  repair_ends_at := _resulting_repair;
  RETURN NEXT;
END;
$function$;