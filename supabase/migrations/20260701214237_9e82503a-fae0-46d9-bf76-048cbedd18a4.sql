CREATE OR REPLACE FUNCTION public.pvp_ship_level(_template_id integer, _catalog_code text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT GREATEST(
    COALESCE(_template_id, 0),
    COALESCE((SELECT sc.market_level_required FROM public.ship_catalog sc WHERE sc.code = _catalog_code LIMIT 1), 0),
    COALESCE((regexp_match(COALESCE(_catalog_code, ''), '^ship-lvl-([0-9]+)$'))[1]::integer, 0)
  )
$function$;

GRANT EXECUTE ON FUNCTION public.pvp_ship_level(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_ship_level(integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.effective_market_level(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT GREATEST(
    COALESCE((
      SELECT GREATEST(
        COALESCE(um.level, 1),
        CASE
          WHEN um.upgrade_ends_at IS NOT NULL
           AND um.upgrade_ends_at <= now() + interval '10 seconds'
           AND um.upgrading_to IS NOT NULL
          THEN um.upgrading_to
          ELSE 0
        END
      )
      FROM public.user_market um
      WHERE um.user_id = _user_id
    ), 1),
    1
  )
$function$;

GRANT EXECUTE ON FUNCTION public.effective_market_level(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.effective_market_level(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.pvp_fleet_count(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(COUNT(*)::integer, 0)
  FROM public.ships_owned s
  WHERE s.user_id = _user_id
    AND public.pvp_ship_level(s.template_id, s.catalog_code) >= 6
$function$;

GRANT EXECUTE ON FUNCTION public.pvp_fleet_count(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_fleet_count(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.has_pvp_fleet(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.pvp_fleet_count(_user_id) >= 3
$function$;

GRANT EXECUTE ON FUNCTION public.has_pvp_fleet(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_pvp_fleet(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.is_market_pvp_unlocked(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.effective_market_level(_user_id) >= 6
$function$;

GRANT EXECUTE ON FUNCTION public.is_market_pvp_unlocked(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_market_pvp_unlocked(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.pvp_requirement_error(_user_id uuid, _actor_label text DEFAULT 'attacker')
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _market integer;
  _fleet integer;
BEGIN
  _market := public.effective_market_level(_user_id);
  _fleet := public.pvp_fleet_count(_user_id);

  IF _market < 6 THEN
    RETURN COALESCE(_actor_label, 'attacker') || ' market level under 6: current=' || _market::text;
  END IF;
  IF _fleet < 3 THEN
    RETURN COALESCE(_actor_label, 'attacker') || ' needs pvp fleet: has=' || _fleet::text || ', required=3, min_ship_level=6';
  END IF;
  RETURN NULL;
END
$function$;

GRANT EXECUTE ON FUNCTION public.pvp_requirement_error(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_requirement_error(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public._prep_pvp_checks(_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.finalize_market_upgrades();
  INSERT INTO public.user_market(user_id, level)
  VALUES (_uid, 1)
  ON CONFLICT (user_id) DO NOTHING;
END;
$function$;

GRANT EXECUTE ON FUNCTION public._prep_pvp_checks(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._prep_pvp_checks(uuid) TO service_role;

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
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

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

  _req_error := public.pvp_requirement_error(_attacker, 'attacker');
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;

  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;

  _req_error := public.pvp_requirement_error(_defender, 'target');
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%).', _req_error; END IF;

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
  _xp int;
  _def_prot timestamptz;
  _def_gf timestamptz;
  _mult numeric;
  _req_error text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;
  _xp := GREATEST(0, LEAST(COALESCE(_xp_gain, 0), 100000));

  PERFORM public._prep_pvp_checks(_uid);
  PERFORM public._prep_pvp_checks(_defender_id);

  IF NOT public.is_admin(_uid) THEN
    _req_error := public.pvp_requirement_error(_uid, 'attacker');
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
    _req_error := public.pvp_requirement_error(_defender_id, 'defender');
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
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
END
$function$;

CREATE OR REPLACE FUNCTION public.send_support(_recipient_id uuid, _ship_id uuid, _kind text, _crew_id text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _sender_name text;
  _sender_emoji text;
  _ship_owner uuid;
  _inv_id uuid;
  _crew_qty int;
  _msg text;
  _title text;
  _body_action text;
  _expires timestamptz := now() + interval '24 hours';
  _is_fixer boolean;
  _is_fixer_legendary boolean;
  _is_trader boolean;
  _is_market_expert boolean;
  _is_golden_fisher boolean;
  _is_persistent boolean;
  _heal int := 0;
  _affected int := 0;
  _trader_ends timestamptz;
  _crew_label text;
  _gf_current timestamptz;
  _gf_new_until timestamptz;
  _req_error text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _recipient_id THEN RAISE EXCEPTION 'cannot support self'; END IF;
  IF _kind NOT IN ('repair','crew') THEN RAISE EXCEPTION 'bad kind'; END IF;

  PERFORM public._prep_pvp_checks(_me);
  PERFORM public._prep_pvp_checks(_recipient_id);

  IF public.is_banned(_me) THEN RAISE EXCEPTION 'account banned'; END IF;
  IF public.is_banned(_recipient_id) THEN RAISE EXCEPTION 'recipient banned'; END IF;

  IF NOT public.is_admin(_me) THEN
    _req_error := public.pvp_requirement_error(_me, 'sender');
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;

    _req_error := public.pvp_requirement_error(_recipient_id, 'recipient');
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION 'recipient is a new player (%).', _req_error; END IF;

    IF public.users_same_device(_me, _recipient_id) THEN
      INSERT INTO public.account_links(user_a, user_b, link_type, details)
      VALUES (_me, _recipient_id, 'device', jsonb_build_object('via','send_support'))
      ON CONFLICT DO NOTHING;
      PERFORM public.flag_cheat(_me, 'same_device_support', 3,
        jsonb_build_object('recipient', _recipient_id, 'kind', _kind));
      PERFORM public.flag_cheat(_recipient_id, 'same_device_support', 3,
        jsonb_build_object('sender', _me, 'kind', _kind));
      RAISE EXCEPTION 'blocked: cannot send support to an account on the same device';
    END IF;
  END IF;

  SELECT display_name, avatar_emoji INTO _sender_name, _sender_emoji
  FROM public.profiles WHERE id = _me;
  IF _sender_name IS NULL THEN _sender_name := 'صديق'; END IF;
  IF _sender_emoji IS NULL THEN _sender_emoji := '🤝'; END IF;

  SELECT user_id INTO _ship_owner
  FROM public.ships_owned
  WHERE id = _ship_id
  FOR UPDATE;

  IF _ship_owner IS NULL OR _ship_owner <> _recipient_id THEN
    RAISE EXCEPTION 'target ship does not belong to recipient';
  END IF;

  IF _kind = 'repair' THEN
    UPDATE public.ships_owned
       SET hp = max_hp,
           destroyed_at = NULL,
           repair_ends_at = NULL
     WHERE id = _ship_id
       AND user_id = _recipient_id;

    _msg := 'إصلاح فوري للسفينة';
    INSERT INTO public.support_gifts (sender_id, recipient_id, ship_id, kind, amount, message, claimed)
    VALUES (_me, _recipient_id, _ship_id, 'repair', 0, _msg, true);
    INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
    VALUES (_recipient_id, '🛠️ صلّح لك سفينتك!',
      _sender_emoji || ' ' || _sender_name || ' أصلح سفينتك بالكامل', 'support', _me);

    RETURN;
  END IF;

  IF _crew_id IS NULL OR length(_crew_id) = 0 THEN RAISE EXCEPTION 'missing crew id'; END IF;

  _is_fixer           := _crew_id IN ('fixer_1','fixer_2','fixer_3','fixer_4');
  _is_fixer_legendary := _crew_id = 'fixer_4';
  _is_trader          := _crew_id = 'trader';
  _is_market_expert   := _crew_id = 'market_expert';
  _is_golden_fisher   := _crew_id = 'golden_fisher';
  _is_persistent      := NOT (_is_fixer OR _is_trader OR _is_market_expert OR _is_golden_fisher);

  _heal := CASE _crew_id
    WHEN 'fixer_1' THEN 1000
    WHEN 'fixer_2' THEN 5000
    WHEN 'fixer_3' THEN 70000
    ELSE 0
  END;

  _crew_label := CASE _crew_id
    WHEN 'luck' THEN 'الحظ'
    WHEN 'guide' THEN 'المرشد'
    WHEN 'sailor' THEN 'البحار'
    WHEN 'thief' THEN 'اللص'
    WHEN 'police' THEN 'الشرطي'
    WHEN 'trader' THEN 'التاجر'
    WHEN 'market_expert' THEN 'خبير الأسواق'
    WHEN 'fixer_1' THEN 'مصلح صغير'
    WHEN 'fixer_2' THEN 'مصلح متوسط'
    WHEN 'fixer_3' THEN 'مصلح كبير'
    WHEN 'fixer_4' THEN 'مصلح أسطوري'
    WHEN 'golden_fisher' THEN 'الصياد الذهبي'
    ELSE _crew_id
  END;

  SELECT id, quantity INTO _inv_id, _crew_qty
  FROM public.inventory
  WHERE user_id = _me
    AND item_type = 'crew'
    AND item_id = _crew_id
    AND quantity > 0
    AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
  ORDER BY acquired_at, id
  LIMIT 1
  FOR UPDATE;

  IF _inv_id IS NULL OR _crew_qty IS NULL OR _crew_qty < 1 THEN
    RAISE EXCEPTION 'sender has no such crew';
  END IF;

  IF _is_persistent THEN
    DELETE FROM public.inventory
    WHERE user_id = _recipient_id
      AND item_type = 'crew'
      AND item_id = _crew_id
      AND meta->>'assigned_ship_id' = _ship_id::text
      AND (meta->>'expires_at') IS NOT NULL
      AND (meta->>'expires_at')::timestamptz <= now();

    IF EXISTS (
      SELECT 1
      FROM public.inventory
      WHERE user_id = _recipient_id
        AND item_type = 'crew'
        AND item_id = _crew_id
        AND meta->>'assigned_ship_id' = _ship_id::text
        AND ((meta->>'expires_at') IS NULL OR (meta->>'expires_at')::timestamptz > now())
    ) THEN
      RAISE EXCEPTION 'recipient ship already has this crew';
    END IF;

    INSERT INTO public.inventory (user_id, item_type, item_id, quantity, meta)
    VALUES (_recipient_id, 'crew', _crew_id, 1,
            jsonb_build_object('assigned_ship_id', _ship_id::text, 'expires_at', _expires));

    _msg := 'طاقم: ' || _crew_id;
    _title := '👨‍✈️ أرسل لك طاقم دعم!';
    _body_action := 'أرسل طاقم ' || _crew_label || ' إلى سفينتك';
  ELSE
    DELETE FROM public.inventory
    WHERE user_id = _recipient_id
      AND item_type = 'crew'
      AND item_id = _crew_id
      AND (meta->>'expires_at') IS NOT NULL
      AND (meta->>'expires_at')::timestamptz <= now();

    IF _is_fixer_legendary THEN
      UPDATE public.ships_owned
         SET hp = max_hp,
             destroyed_at = NULL,
             repair_ends_at = NULL
       WHERE user_id = _recipient_id
         AND (destroyed_at IS NOT NULL OR COALESCE(hp,0) < COALESCE(max_hp,0));
      GET DIAGNOSTICS _affected = ROW_COUNT;
      _msg := 'مصلح أسطوري: أصلح كل السفن (' || _affected || ')';
      _title := '🛠️ مصلح أسطوري وصل!';
      _body_action := 'أصلح كل سفنك فورًا';
    ELSIF _is_fixer THEN
      UPDATE public.ships_owned
         SET hp = LEAST(max_hp, COALESCE(hp,0) + _heal),
             destroyed_at = CASE WHEN COALESCE(hp,0) + _heal >= max_hp THEN NULL ELSE destroyed_at END,
             repair_ends_at = CASE WHEN COALESCE(hp,0) + _heal >= max_hp THEN NULL ELSE repair_ends_at END
       WHERE id = _ship_id
         AND user_id = _recipient_id;
      _msg := 'مصلح: +' || _heal || ' HP';
      _title := '🛠️ أرسل لك مصلّح!';
      _body_action := 'أصلح سفينتك +' || _heal || ' HP';
    ELSIF _is_trader THEN
      SELECT ms.trader_until INTO _trader_ends FROM public.user_market_state ms WHERE ms.user_id = _recipient_id;
      IF _trader_ends IS NOT NULL AND _trader_ends > now() THEN
        RAISE EXCEPTION 'recipient already has active trader';
      END IF;
      INSERT INTO public.user_market_state(user_id, trader_until, updated_at)
      VALUES (_recipient_id, now() + interval '24 hours', now())
      ON CONFLICT (user_id) DO UPDATE
        SET trader_until = EXCLUDED.trader_until,
            trader_snapshot = '{}'::jsonb,
            trader_anchor = NULL,
            updated_at = now();
      _msg := 'تاجر: 24 ساعة';
      _title := '💰 أرسل لك تاجر!';
      _body_action := 'فعّل التاجر في سوق السمك لمدة 24 ساعة';
    ELSIF _is_market_expert THEN
      UPDATE public.profiles
         SET market_expert_until = GREATEST(COALESCE(market_expert_until, now()), now()) + interval '24 hours'
       WHERE id = _recipient_id;
      _msg := 'خبير الأسواق: 24 ساعة';
      _title := '📈 أرسل لك خبير الأسواق!';
      _body_action := 'فعّل خبير الأسواق لمدة 24 ساعة';
    ELSIF _is_golden_fisher THEN
      SELECT golden_fisher_until INTO _gf_current FROM public.profiles WHERE id = _recipient_id;
      _gf_new_until := GREATEST(COALESCE(_gf_current, now()), now()) + interval '24 hours';
      UPDATE public.profiles
         SET golden_fisher_until = _gf_new_until,
             protection_until = GREATEST(COALESCE(protection_until, now()), _gf_new_until)
       WHERE id = _recipient_id;
      _msg := 'الصياد الذهبي: 24 ساعة';
      _title := '🟡 أرسل لك الصياد الذهبي!';
      _body_action := 'فعّل الصياد الذهبي لمدة 24 ساعة';
    ELSE
      RAISE EXCEPTION 'unsupported crew support';
    END IF;
  END IF;

  IF _crew_qty = 1 THEN
    DELETE FROM public.inventory WHERE id = _inv_id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _inv_id;
  END IF;

  INSERT INTO public.support_gifts (sender_id, recipient_id, ship_id, kind, amount, message, claimed)
  VALUES (_me, _recipient_id, _ship_id, 'crew', 1, _msg, true);

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
  VALUES (_recipient_id, _title,
    _sender_emoji || ' ' || _sender_name || ' ' || _body_action, 'support', _me);
END
$function$;