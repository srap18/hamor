
CREATE OR REPLACE FUNCTION public.drop_my_protection()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.profiles
     SET protection_until = NULL,
         golden_fisher_until = NULL,
         golden_fisher_last_activated_at = NULL,
         shield_cooldown_until = now() + interval '2 minutes'
   WHERE id = auth.uid();
END;
$function$;


CREATE OR REPLACE FUNCTION public.record_attack(_defender_id uuid, _target_ship_id uuid, _damage integer, _damage_dealt integer, _attacker_won boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _id uuid; _def_prot timestamptz; _def_gf timestamptz; _mult numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;
  IF NOT public.is_admin(_uid) THEN
    IF NOT public.is_market_pvp_unlocked(_uid) THEN RAISE EXCEPTION 'attacker market level under 6'; END IF;
    IF NOT public.has_pvp_fleet(_uid) THEN RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher'; END IF;
    IF NOT public.is_market_pvp_unlocked(_defender_id) THEN RAISE EXCEPTION 'defender market level under 6'; END IF;
  END IF;

  SELECT protection_until, golden_fisher_until INTO _def_prot, _def_gf FROM public.profiles WHERE id = _defender_id;
  IF (_def_prot IS NOT NULL AND _def_prot > now()) OR (_def_gf IS NOT NULL AND _def_gf > now()) THEN
    IF _def_gf IS NOT NULL AND _def_gf > now() THEN
      UPDATE public.profiles
        SET protection_until = GREATEST(COALESCE(protection_until, _def_gf), _def_gf)
        WHERE id = _defender_id;
    END IF;
    RAISE EXCEPTION 'defender_protected';
  END IF;

  -- Attacker loses ALL shields permanently (regular + golden fisher)
  UPDATE public.profiles
     SET protection_until = NULL,
         golden_fisher_until = NULL,
         golden_fisher_last_activated_at = NULL
   WHERE id = _uid
     AND ( (protection_until IS NOT NULL AND protection_until > now())
        OR (golden_fisher_until IS NOT NULL AND golden_fisher_until > now()) );

  _mult := public.get_combat_multiplier(_uid);
  _damage := LEAST(10000000, GREATEST(0, FLOOR(_damage::numeric * _mult)::int));
  _damage_dealt := LEAST(_damage, GREATEST(0, FLOOR(_damage_dealt::numeric * _mult)::int));
  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;
  RETURN _id;
END $function$;


CREATE OR REPLACE FUNCTION public.record_attack(_defender_id uuid, _target_ship_id uuid, _damage integer, _damage_dealt integer, _attacker_won boolean, _xp_gain integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _id uuid; _xp int; _def_prot timestamptz; _def_gf timestamptz; _mult numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;
  _xp := GREATEST(0, LEAST(COALESCE(_xp_gain, 0), 100000));
  IF NOT public.is_admin(_uid) THEN
    IF NOT public.is_market_pvp_unlocked(_uid) THEN RAISE EXCEPTION 'attacker market level under 6'; END IF;
    IF NOT public.has_pvp_fleet(_uid) THEN RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher'; END IF;
    IF NOT public.is_market_pvp_unlocked(_defender_id) THEN RAISE EXCEPTION 'defender market level under 6'; END IF;
  END IF;

  SELECT protection_until, golden_fisher_until INTO _def_prot, _def_gf FROM public.profiles WHERE id = _defender_id;
  IF (_def_prot IS NOT NULL AND _def_prot > now()) OR (_def_gf IS NOT NULL AND _def_gf > now()) THEN
    IF _def_gf IS NOT NULL AND _def_gf > now() THEN
      UPDATE public.profiles
        SET protection_until = GREATEST(COALESCE(protection_until, _def_gf), _def_gf)
        WHERE id = _defender_id;
    END IF;
    RAISE EXCEPTION 'defender_protected';
  END IF;

  UPDATE public.profiles
     SET protection_until = NULL,
         golden_fisher_until = NULL,
         golden_fisher_last_activated_at = NULL
   WHERE id = _uid
     AND ( (protection_until IS NOT NULL AND protection_until > now())
        OR (golden_fisher_until IS NOT NULL AND golden_fisher_until > now()) );

  _mult := public.get_combat_multiplier(_uid);
  _damage := LEAST(10000000, GREATEST(0, FLOOR(_damage::numeric * _mult)::int));
  _damage_dealt := LEAST(_damage, GREATEST(0, FLOOR(_damage_dealt::numeric * _mult)::int));
  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins, xp_gain)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0, _xp)
    RETURNING id INTO _id;
  RETURN _id;
END $function$;
