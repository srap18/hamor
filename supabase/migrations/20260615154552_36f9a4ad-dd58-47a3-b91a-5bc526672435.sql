
CREATE OR REPLACE FUNCTION public.record_attack(_defender_id uuid, _target_ship_id uuid, _damage integer, _damage_dealt integer, _attacker_won boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _id uuid; _def_prot timestamptz; _def_gf timestamptz; _mult numeric; _def_can_attack boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;

  IF NOT public.is_admin(_uid) THEN
    IF NOT public.is_market_pvp_unlocked(_uid) THEN
      RAISE EXCEPTION 'attacker market level under 6';
    END IF;
    IF NOT public.has_pvp_fleet(_uid) THEN
      RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
    END IF;
    IF NOT public.is_market_pvp_unlocked(_defender_id) THEN
      RAISE EXCEPTION 'defender market level under 6';
    END IF;
  END IF;

  -- A defender who themselves qualifies to attack (PvP fleet + market 6)
  -- cannot hide behind golden-fisher or shield protection.
  _def_can_attack := public.has_pvp_fleet(_defender_id) AND public.is_market_pvp_unlocked(_defender_id);

  SELECT protection_until, golden_fisher_until INTO _def_prot, _def_gf
    FROM public.profiles WHERE id = _defender_id;

  IF NOT _def_can_attack THEN
    IF (_def_prot IS NOT NULL AND _def_prot > now())
       OR (_def_gf IS NOT NULL AND _def_gf > now()) THEN
      RAISE EXCEPTION 'defender_protected';
    END IF;
  ELSE
    -- Drop their shelter immediately so future checks are consistent.
    UPDATE public.profiles
       SET protection_until = NULL,
           golden_fisher_until = NULL
     WHERE id = _defender_id
       AND ((protection_until IS NOT NULL AND protection_until > now())
         OR (golden_fisher_until IS NOT NULL AND golden_fisher_until > now()));
  END IF;

  UPDATE public.profiles
    SET protection_until = NULL
    WHERE id = _uid AND protection_until IS NOT NULL AND protection_until > now()
      AND (golden_fisher_until IS NULL OR golden_fisher_until <= now());

  _mult := public.get_combat_multiplier(_uid);
  _damage := LEAST(10000000, GREATEST(0, FLOOR(_damage::numeric * _mult)::int));
  _damage_dealt := LEAST(_damage, GREATEST(0, FLOOR(_damage_dealt::numeric * _mult)::int));

  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;
  RETURN _id;
END $function$;

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
  _gf timestamptz;
  _attacker uuid := auth.uid();
  _prev_hp int;
  _def_can_attack boolean;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT s.user_id, s.template_id, COALESCE(s.hp, 100)
    INTO _owner, _tpl, _prev_hp
    FROM public.ships_owned s
   WHERE s.id = _ship_id;

  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = _attacker THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN
    RAISE EXCEPTION 'attacker market level under 6';
  END IF;

  IF NOT public.has_pvp_fleet(_attacker) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;

  IF NOT public.is_market_pvp_unlocked(_owner) THEN
    RAISE EXCEPTION 'target is protected (market level under 6)';
  END IF;

  -- If the defender themselves can attack (PvP fleet + market 6),
  -- their protection / golden-fisher shelter is ignored and cleared.
  _def_can_attack := public.has_pvp_fleet(_owner) AND public.is_market_pvp_unlocked(_owner);

  SELECT protection_until, golden_fisher_until INTO _prot, _gf
    FROM public.profiles WHERE id = _owner;

  IF NOT _def_can_attack THEN
    IF _prot IS NOT NULL AND _prot > now() THEN
      RAISE EXCEPTION 'protected';
    END IF;
    IF _gf IS NOT NULL AND _gf > now() THEN
      RAISE EXCEPTION 'protected';
    END IF;
  ELSE
    UPDATE public.profiles
       SET protection_until = NULL,
           golden_fisher_until = NULL
     WHERE id = _owner
       AND ((protection_until IS NOT NULL AND protection_until > now())
         OR (golden_fisher_until IS NOT NULL AND golden_fisher_until > now()));
  END IF;

  _tpl := COALESCE(_tpl, 1);
  _repair_secs := LEAST(14400, GREATEST(60,
    ROUND(60 + (LEAST(30, GREATEST(1, _tpl)) - 1) * (14400 - 60) / 29.0)::int
  ));

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
           WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 AND s.destroyed_at IS NULL
           THEN now() + (_repair_secs || ' seconds')::interval
           ELSE s.repair_ends_at END,
         at_sea = CASE
           WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 THEN false
           ELSE s.at_sea END,
         fishing_started_at = CASE
           WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 THEN NULL
           ELSE s.fishing_started_at END
   WHERE s.id = _ship_id
   RETURNING s.hp, s.repair_ends_at INTO _resulting_hp, _resulting_repair;

  RETURN QUERY SELECT _resulting_hp, (_resulting_hp = 0), _resulting_repair;
END $function$;
