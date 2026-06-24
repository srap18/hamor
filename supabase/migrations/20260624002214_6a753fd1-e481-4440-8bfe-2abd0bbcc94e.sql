CREATE OR REPLACE FUNCTION public.apply_ship_damage_v2(_ship_id uuid, _weapon_id text, _skip_fishing_check boolean DEFAULT false)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamptz, damage_applied integer, blocked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

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

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN RAISE EXCEPTION 'attacker market level under 6'; END IF;
  IF NOT public.has_pvp_fleet(_attacker) THEN RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher'; END IF;
  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;
  IF NOT public.is_market_pvp_unlocked(_defender) THEN RAISE EXCEPTION 'target is protected (market level under 6)'; END IF;

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

    INSERT INTO public.notifications(recipient_id, kind, title, body, created_by, meta)
    VALUES (_defender, 'anti_block', '🛡️ مضاد الصواريخ صدّ هجوم!',
      'صد مضادك ' || _weapon_label || ' من ' || COALESCE(_attacker_name, 'لاعب'),
      _attacker, jsonb_build_object('anti_id','anti_rocket','attacker_id',_attacker,'weapon_id',_weapon_id));

    INSERT INTO public.notifications(recipient_id, kind, title, body, created_by, meta)
    VALUES (_attacker, 'anti_block_attacker', '⚠️ تم صد صاروخك',
      'مضاد ' || COALESCE(_defender_name, 'الخصم') || ' صد ' || _weapon_label,
      _defender, jsonb_build_object('anti_id','anti_rocket','defender_id',_defender,'weapon_id',_weapon_id));

    INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
    VALUES ('anti_block', _attacker, COALESCE(_attacker_name,'لاعب'), _defender, COALESCE(_defender_name,'لاعب'),
            _weapon_label, '🛡️');

    BEGIN
      INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
      VALUES (_attacker, _defender, _ship_id, _final_damage, 0, false, 0);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RETURN QUERY SELECT _prev_hp, false, _def_ship_repair_ends_at, 0, true;
    RETURN;
  END IF;

  SELECT d.new_hp, d.destroyed, d.repair_ends_at
    INTO _result_new_hp, _result_destroyed, _result_repair_ends_at
    FROM public.apply_ship_damage(_ship_id, _final_damage, _skip_fishing_check) AS d;

  _actual_damage := GREATEST(0, COALESCE(_prev_hp,0) - COALESCE(_result_new_hp,0));

  BEGIN
    INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_attacker, _defender, _ship_id, _final_damage, _actual_damage, COALESCE(_result_destroyed, false), 0);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF _actual_damage > 0 AND _weapon_xp > 0 THEN
    UPDATE public.profiles SET xp = COALESCE(xp,0) + _weapon_xp WHERE id = _attacker;
  END IF;

  RETURN QUERY SELECT _result_new_hp, COALESCE(_result_destroyed, false), _result_repair_ends_at, _final_damage, false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_ship_damage_v2(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_ship_damage_v2(uuid, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.start_steal_mission(_attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid)
RETURNS TABLE(ends_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _my_ship public.ships_owned%ROWTYPE;
  _their_ship public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _secs integer;
  _ends timestamptz;
  _started timestamptz := now();
  _attacker_name text;
  _attacker_emoji text;
  _target_protection timestamptz;
  _target_golden_until timestamptz;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _target_user_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;
  IF public.is_admin(_target_user_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;
  IF NOT public.is_market_pvp_unlocked(_me) THEN RAISE EXCEPTION 'attacker market level under 6'; END IF;
  IF NOT public.has_pvp_fleet(_me) THEN RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher'; END IF;
  IF NOT public.is_market_pvp_unlocked(_target_user_id) THEN RAISE EXCEPTION 'target is protected (market level under 6)'; END IF;
  IF NOT public.is_admin(_me) AND public.users_same_device(_me, _target_user_id) THEN
    RAISE EXCEPTION 'blocked: cannot steal from an account on the same device';
  END IF;

  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = _me AND protection_until IS NOT NULL;

  SELECT protection_until, public.golden_fisher_active_until(id)
    INTO _target_protection, _target_golden_until
  FROM public.profiles
  WHERE id = _target_user_id
  FOR UPDATE;

  IF (_target_protection IS NOT NULL AND _target_protection > now())
     OR (_target_golden_until IS NOT NULL AND _target_golden_until > now()) THEN
    UPDATE public.profiles
       SET golden_fisher_until = GREATEST(COALESCE(golden_fisher_until, '-infinity'::timestamptz), COALESCE(_target_golden_until, '-infinity'::timestamptz)),
           protection_until = GREATEST(COALESCE(protection_until, now()), COALESCE(_target_golden_until, protection_until, now()))
     WHERE id = _target_user_id
       AND _target_golden_until IS NOT NULL
       AND _target_golden_until > now();
    RAISE EXCEPTION 'target is shielded';
  END IF;

  SELECT * INTO _my_ship FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _me FOR UPDATE;
  IF _my_ship.id IS NULL THEN RAISE EXCEPTION 'attacker ship not found'; END IF;
  IF _my_ship.in_storage THEN RAISE EXCEPTION 'attacker ship in storage'; END IF;
  IF _my_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'attacker ship destroyed'; END IF;
  IF _my_ship.at_sea THEN RAISE EXCEPTION 'attacker ship busy'; END IF;
  IF _my_ship.stealing_ends_at IS NOT NULL AND _my_ship.stealing_ends_at > now() THEN
    RAISE EXCEPTION 'attacker ship already stealing';
  END IF;

  SELECT * INTO _their_ship FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _target_user_id FOR UPDATE;
  IF _their_ship.id IS NULL THEN RAISE EXCEPTION 'target ship not found'; END IF;
  IF NOT _their_ship.at_sea OR _their_ship.fishing_started_at IS NULL THEN
    RAISE EXCEPTION 'target ship not fishing';
  END IF;

  IF _my_ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = _my_ship.catalog_code AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = ('ship-lvl-' || COALESCE(_my_ship.template_id, 1)) AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE sort_order = COALESCE(_my_ship.template_id, 1) AND active = true ORDER BY market_level_required ASC LIMIT 1;
  END IF;

  _secs := GREATEST(30, ROUND(COALESCE(_cat.fishing_seconds, 60) * 0.6)::int);
  _ends := now() + (_secs || ' seconds')::interval;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         last_fishing_reward_at = now()
   WHERE id = _their_ship.id;

  UPDATE public.ships_owned
     SET stealing_target_user_id = _target_user_id,
         stealing_target_ship_id = _target_ship_id,
         stealing_ends_at = _ends,
         stealing_started_at = _started
   WHERE id = _my_ship.id;

  SELECT display_name, avatar_emoji INTO _attacker_name, _attacker_emoji FROM public.profiles WHERE id = _me;
  PERFORM public.notify_steal_started(_target_user_id, _me, _attacker_name, _attacker_emoji);

  RETURN QUERY SELECT _ends;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_steal_mission(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_steal_mission(uuid, uuid, uuid) TO service_role;