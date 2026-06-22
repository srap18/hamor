CREATE OR REPLACE FUNCTION public.apply_ship_damage_v2(_ship_id uuid, _weapon_id text, _skip_fishing_check boolean DEFAULT false)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone, damage_applied integer)
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
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT wc.damage, COALESCE(wc.xp,0) INTO _base_damage, _weapon_xp
    FROM public.weapons_catalog AS wc
   WHERE wc.id = _weapon_id;
  IF _base_damage IS NULL THEN RAISE EXCEPTION 'Unknown weapon: %', _weapon_id; END IF;

  _mult := public.get_combat_multiplier(_attacker);
  _final_damage := GREATEST(0, FLOOR(_base_damage * _mult))::integer;

  SELECT s.user_id, COALESCE(s.hp,0), s.repair_ends_at
    INTO _defender, _prev_hp, _def_ship_repair_ends_at
    FROM public.ships_owned AS s
   WHERE s.id = _ship_id;

  _is_rocket := _weapon_id IN ('rocket_small','rocket_medium','rocket_large');

  IF _is_rocket AND _defender IS NOT NULL AND _defender <> _attacker THEN
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
    VALUES (_defender, 'anti_block',
      '🛡️ مضاد الصواريخ صدّ هجوم!',
      'صد مضادك ' || _weapon_label || ' من ' || COALESCE(_attacker_name, 'لاعب'),
      _attacker,
      jsonb_build_object('anti_id','anti_rocket','attacker_id',_attacker,'weapon_id',_weapon_id));

    INSERT INTO public.notifications(recipient_id, kind, title, body, created_by, meta)
    VALUES (_attacker, 'anti_block_attacker',
      '⚠️ تم صد صاروخك',
      'مضاد ' || COALESCE(_defender_name, 'الخصم') || ' صد ' || _weapon_label,
      _defender,
      jsonb_build_object('anti_id','anti_rocket','defender_id',_defender,'weapon_id',_weapon_id));

    INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
    VALUES ('anti_block', _attacker, COALESCE(_attacker_name,'لاعب'), _defender, COALESCE(_defender_name,'لاعب'),
            _weapon_label, '🛡️');

    BEGIN
      INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
      VALUES (_attacker, _defender, _ship_id, _final_damage, 0, false, 0);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RETURN QUERY SELECT _prev_hp, false, _def_ship_repair_ends_at, 0;
    RETURN;
  END IF;

  SELECT d.new_hp, d.destroyed, d.repair_ends_at
    INTO _result_new_hp, _result_destroyed, _result_repair_ends_at
    FROM public.apply_ship_damage(_ship_id, _final_damage, _skip_fishing_check) AS d;

  _actual_damage := GREATEST(0, COALESCE(_prev_hp,0) - COALESCE(_result_new_hp,0));

  IF _defender IS NOT NULL AND _defender <> _attacker THEN
    BEGIN
      INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
      VALUES (_attacker, _defender, _ship_id, _final_damage, _actual_damage, COALESCE(_result_destroyed, false), 0);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    IF _actual_damage > 0 AND _weapon_xp > 0 THEN
      UPDATE public.profiles SET xp = COALESCE(xp,0) + _weapon_xp WHERE id = _attacker;
    END IF;
  END IF;

  RETURN QUERY SELECT _result_new_hp, COALESCE(_result_destroyed, false), _result_repair_ends_at, _final_damage;
END;
$function$;