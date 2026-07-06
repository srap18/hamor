CREATE OR REPLACE FUNCTION public.record_attack(_defender_id uuid, _target_ship_id uuid, _damage integer, _damage_dealt integer, _attacker_won boolean, _xp_gain integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
  _def_prot timestamptz;
  _def_gf timestamptz;
  _def_gf_no_shield boolean;
  _mult numeric;
  _req_error text;
  _gf_shields boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;

  PERFORM public._prep_pvp_checks(_uid);
  PERFORM public._prep_pvp_checks(_defender_id);

  IF NOT public.is_admin(_uid) THEN
    _req_error := public.pvp_requirement_error(_uid, 'attacker');
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
    _req_error := public.pvp_requirement_error(_defender_id, 'defender');
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
  END IF;

  SELECT protection_until, golden_fisher_until, COALESCE(golden_fisher_no_shield, false)
    INTO _def_prot, _def_gf, _def_gf_no_shield
    FROM public.profiles WHERE id = _defender_id;

  _gf_shields := (_def_gf IS NOT NULL AND _def_gf > now() AND NOT _def_gf_no_shield);

  IF (_def_prot IS NOT NULL AND _def_prot > now()) OR _gf_shields THEN
    IF _gf_shields THEN
      UPDATE public.profiles
        SET protection_until = GREATEST(COALESCE(protection_until, _def_gf), _def_gf)
        WHERE id = _defender_id;
    END IF;
    RAISE EXCEPTION 'defender_protected';
  END IF;

  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = _uid
     AND protection_until IS NOT NULL AND protection_until > now();

  _mult := public.get_combat_multiplier(_uid);
  _damage := LEAST(10000000, GREATEST(0, FLOOR(_damage::numeric * _mult)::int));
  _damage_dealt := LEAST(_damage, GREATEST(0, FLOOR(_damage_dealt::numeric * _mult)::int));
  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;
  RETURN _id;
END
$function$;