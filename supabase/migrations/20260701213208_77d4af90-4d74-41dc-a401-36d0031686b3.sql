
-- Make market unlock check tolerant of just-finished upgrades that haven't been finalized yet.
CREATE OR REPLACE FUNCTION public.is_market_pvp_unlocked(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT GREATEST(
        COALESCE(level, 1),
        CASE
          WHEN upgrade_ends_at IS NOT NULL
           AND upgrade_ends_at <= now() + interval '10 seconds'
           AND upgrading_to IS NOT NULL
          THEN upgrading_to
          ELSE 0
        END
      )
      FROM public.user_market WHERE user_id = _user_id
    ),
    1
  ) >= 6
$$;

-- Auto-finalize any expired market upgrades before validating in every combat / support RPC.
CREATE OR REPLACE FUNCTION public.apply_ship_damage_v2(_ship_id uuid, _weapon_id text, _skip_fishing_check boolean DEFAULT false)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone, damage_applied integer, blocked boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Finalize completed upgrades first so a just-finished market/ship upgrade counts.
  PERFORM public.finalize_market_upgrades();

  -- Ensure attacker has a user_market row so is_market_pvp_unlocked reads a real value.
  INSERT INTO public.user_market(user_id, level) VALUES (_attacker, 1)
    ON CONFLICT (user_id) DO NOTHING;

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
END $function$;

-- Wrap send_support to auto-finalize as well.
CREATE OR REPLACE FUNCTION public._prep_pvp_checks(_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.finalize_market_upgrades();
  INSERT INTO public.user_market(user_id, level) VALUES (_uid, 1)
    ON CONFLICT (user_id) DO NOTHING;
END $$;
