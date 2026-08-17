CREATE OR REPLACE FUNCTION public.apply_ship_damage_v2(_ship_id uuid, _weapon_id text, _skip_fishing_check boolean DEFAULT false)
 RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone, damage_applied integer, blocked boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _base_damage integer;
  _weapon_xp integer;
  _mult numeric;
  _final_damage integer;
  _defender uuid;
  _prev_hp integer;
  _actual_damage integer;
  _is_rocket boolean;
  _blocked boolean := false;
  _attacker_name text;
  _defender_name text;
  _def_ship_repair_ends_at timestamptz;
  _result_new_hp integer;
  _result_destroyed boolean;
  _result_repair_ends_at timestamptz;
  _weapon_label text;
  _req_error text;
  _inv_row record;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  PERFORM public._guard_attack_cadence('attack');
  PERFORM public._prep_pvp_checks(_attacker);

  SELECT wc.damage, COALESCE(wc.xp,0) INTO _base_damage, _weapon_xp
    FROM public.weapons_catalog AS wc WHERE wc.id = _weapon_id;
  IF _base_damage IS NULL THEN RAISE EXCEPTION 'Unknown weapon: %', _weapon_id; END IF;

  _mult := public.get_combat_multiplier(_attacker);
  _final_damage := GREATEST(0, FLOOR(_base_damage * _mult))::integer;

  SELECT s.user_id, COALESCE(s.hp,0), s.repair_ends_at
    INTO _defender, _prev_hp, _def_ship_repair_ends_at
    FROM public.ships_owned AS s WHERE s.id = _ship_id;
  IF _defender IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _defender = _attacker THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  PERFORM public._prep_pvp_checks(_defender);

  _req_error := public.pvp_attacker_requirement_error(_attacker);
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;

  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;

  _req_error := public.pvp_defender_requirement_error(_defender);
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%)', _req_error; END IF;

  _req_error := public.pvp_pair_block_error(_attacker, _defender);
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;

  -- ── ANTI-CHEAT: the weapon must exist in the attacker's inventory and is
  -- consumed here, on the server, atomically with the damage. Client-side
  -- consumption alone allowed unlimited free attacks.
  SELECT id, quantity INTO _inv_row
    FROM public.inventory
   WHERE user_id = _attacker
     AND item_type = 'weapon'
     AND item_id = _weapon_id
     AND quantity > 0
     AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
   ORDER BY acquired_at ASC NULLS LAST, id ASC
   FOR UPDATE
   LIMIT 1;

  IF _inv_row.id IS NULL THEN
    RAISE EXCEPTION 'no % in inventory', _weapon_id;
  END IF;

  IF _inv_row.quantity <= 1 THEN
    DELETE FROM public.inventory WHERE id = _inv_row.id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _inv_row.id;
  END IF;

  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = _attacker AND protection_until IS NOT NULL;

  _is_rocket := _weapon_id IN ('rocket_small','rocket_medium','rocket_large');

  IF _is_rocket THEN
    _blocked := public._try_anti_block(_defender, 'anti_rocket', 60);
  END IF;

  IF _blocked THEN
    SELECT p.display_name INTO _attacker_name FROM public.profiles AS p WHERE p.id = _attacker;
    SELECT p.display_name INTO _defender_name FROM public.profiles AS p WHERE p.id = _defender;
    _weapon_label := CASE _weapon_id
      WHEN 'rocket_small' THEN 'صاروخ صغير'
      WHEN 'rocket_medium' THEN 'صاروخ متوسط'
      WHEN 'rocket_large' THEN 'صاروخ كبير'
      ELSE 'صاروخ' END;

    PERFORM public._upsert_anti_block_notif(_defender, 'anti_block',          _attacker, _attacker_name, _weapon_label, 'anti_rocket');
    PERFORM public._upsert_anti_block_notif(_attacker, 'anti_block_attacker', _defender, _defender_name, _weapon_label, 'anti_rocket');

    RETURN QUERY SELECT _prev_hp, false, _def_ship_repair_ends_at, 0, true;
    RETURN;
  END IF;

  SELECT r.new_hp, r.destroyed, r.repair_ends_at
    INTO _result_new_hp, _result_destroyed, _result_repair_ends_at
    FROM public.apply_ship_damage(_ship_id, _final_damage) AS r;

  _actual_damage := GREATEST(0, _prev_hp - COALESCE(_result_new_hp, 0));

  IF _weapon_xp > 0 THEN
    PERFORM public.add_xp(_attacker, _weapon_xp);
  END IF;

  RETURN QUERY SELECT _result_new_hp, _result_destroyed, _result_repair_ends_at, _actual_damage, false;
END
$function$;

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
  _cap integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 THEN RAISE EXCEPTION 'bad damage'; END IF;

  -- ANTI-CHEAT: never trust the client damage number. Cap it at the strongest
  -- weapon in the catalog (AOE weapons hit the whole fleet, hence x8).
  SELECT COALESCE(MAX(wc.damage), 0) * 8 INTO _cap FROM public.weapons_catalog AS wc;
  _cap := GREATEST(1, LEAST(_cap, 10000000));
  _damage := LEAST(_damage, _cap);
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;

  PERFORM public._enforce_combat_cooldown();
  PERFORM public._prep_pvp_checks(_uid);
  PERFORM public._prep_pvp_checks(_defender_id);

  IF NOT public.is_admin(_uid) THEN
    _req_error := public.pvp_attacker_requirement_error(_uid);
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
    _req_error := public.pvp_defender_requirement_error(_defender_id);
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
    _req_error := public.pvp_pair_block_error(_uid, _defender_id);
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

  UPDATE public.profiles SET protection_until = NULL
   WHERE id = _uid AND protection_until IS NOT NULL AND protection_until > now();

  _mult := public.get_combat_multiplier(_uid);
  _damage := LEAST(_cap, GREATEST(0, FLOOR(_damage::numeric * _mult)::int));
  _damage_dealt := LEAST(_damage, GREATEST(0, FLOOR(_damage_dealt::numeric * _mult)::int));
  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;
  RETURN _id;
END
$function$;