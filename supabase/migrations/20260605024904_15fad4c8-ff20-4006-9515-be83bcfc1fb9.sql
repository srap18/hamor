
-- Require attacker's own ship market to be level 6+ for damage and steal
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  IF NOT public.has_fishing_ship(_attacker) THEN
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
$$;

-- Same gate for steal missions
CREATE OR REPLACE FUNCTION public.start_steal_mission(_attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid)
 RETURNS TABLE(ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _my_ship public.ships_owned%ROWTYPE;
  _their_ship public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _blk timestamptz;
  _secs integer;
  _ends timestamptz;
  _bypass boolean := false;
  _has_police boolean;
  _has_thief boolean;
  _started timestamptz := now();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _target_user_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;

  IF NOT public.is_market_pvp_unlocked(_me) THEN
    RAISE EXCEPTION 'attacker market level under 6';
  END IF;

  IF NOT public.has_pvp_fleet(_me) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;
  IF NOT public.is_market_pvp_unlocked(_target_user_id) THEN
    RAISE EXCEPTION 'target is protected (market level under 6)';
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
   WHERE id = _attacker_ship_id AND user_id = _me
     AND stealing_target_user_id IS NOT NULL
     AND stealing_ends_at IS NOT NULL
     AND stealing_ends_at <= now();

  SELECT steal_blocked_until INTO _blk FROM public.profiles WHERE id = _me;
  IF _blk IS NOT NULL AND _blk > now() THEN
    RAISE EXCEPTION 'thief blocked until %', _blk;
  END IF;

  SELECT * INTO _my_ship FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _me;
  IF NOT FOUND THEN RAISE EXCEPTION 'attacker ship not found'; END IF;
  IF _my_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'ship is destroyed'; END IF;
  IF _my_ship.at_sea THEN RAISE EXCEPTION 'ship is busy at sea'; END IF;
  IF _my_ship.repair_ends_at IS NOT NULL AND _my_ship.repair_ends_at > now() THEN
    RAISE EXCEPTION 'ship under repair';
  END IF;

  SELECT * INTO _their_ship FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'target ship not found'; END IF;
  IF _their_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'target ship destroyed'; END IF;
  IF NOT _their_ship.at_sea OR _their_ship.stealing_target_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'target not fishing';
  END IF;

  IF _their_ship.fishing_started_at IS NULL THEN
    UPDATE public.ships_owned SET fishing_started_at = now()
     WHERE id = _target_ship_id AND fishing_started_at IS NULL;
    _their_ship.fishing_started_at := now();
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE stealing_target_ship_id = _target_ship_id
       AND stealing_ends_at IS NOT NULL AND stealing_ends_at > now()
  ) THEN
    RAISE EXCEPTION 'target ship already being raided';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.inventory
     WHERE user_id = _target_user_id
       AND item_type = 'crew' AND item_id = 'police' AND quantity > 0
       AND meta->>'assigned_ship_id' = _target_ship_id::text
       AND (meta->>'expires_at' IS NULL OR (meta->>'expires_at')::timestamptz > now())
  ) INTO _has_police;

  SELECT EXISTS (
    SELECT 1 FROM public.inventory
     WHERE user_id = _me
       AND item_type = 'crew' AND item_id = 'thief' AND quantity > 0
       AND meta->>'assigned_ship_id' = _attacker_ship_id::text
       AND (meta->>'expires_at' IS NULL OR (meta->>'expires_at')::timestamptz > now())
  ) INTO _has_thief;

  IF _has_police AND NOT _has_thief THEN
    RAISE EXCEPTION 'target ship protected by police';
  END IF;
  IF _has_thief THEN _bypass := true; END IF;

  IF _my_ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = _my_ship.catalog_code AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = ('ship-lvl-' || COALESCE(_my_ship.template_id, 1)) AND active = true LIMIT 1;
  END IF;

  _secs := GREATEST(30, COALESCE(_cat.fishing_seconds, 60));
  _ends := _started + make_interval(secs => _secs);

  UPDATE public.ships_owned
     SET at_sea = true,
         fishing_started_at = _started,
         stealing_target_user_id = _target_user_id,
         stealing_target_ship_id = _target_ship_id,
         stealing_ends_at = _ends
   WHERE id = _attacker_ship_id;

  ends_at := _ends;
  RETURN NEXT;
END;
$function$;
