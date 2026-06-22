
-- 1) Buy anti-weapon items to inventory (gems only)
CREATE OR REPLACE FUNCTION public.buy_anti_to_inventory(_item_id text, _qty integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _unit_gems int;
  _total_gems int;
  _cur_gems int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty < 1 OR _qty > 50 THEN RAISE EXCEPTION 'bad qty'; END IF;

  _unit_gems := CASE _item_id
    WHEN 'anti_rocket'   THEN 50
    WHEN 'anti_nuke'     THEN 120
    WHEN 'anti_ad_bomb'  THEN 210
    ELSE 0 END;
  IF _unit_gems = 0 THEN RAISE EXCEPTION 'invalid_anti'; END IF;

  _total_gems := _unit_gems * _qty;

  SELECT gems INTO _cur_gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _cur_gems IS NULL OR _cur_gems < _total_gems THEN
    RAISE EXCEPTION 'insufficient gems';
  END IF;

  PERFORM public._mutate_currency(_uid, 0, -_total_gems, 0, 0);

  INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
  VALUES (_uid, 'anti', _item_id, _qty)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;

  RETURN jsonb_build_object('ok', true, 'item_id', _item_id, 'qty', _qty, 'gems_spent', _total_gems);
END;
$$;

GRANT EXECUTE ON FUNCTION public.buy_anti_to_inventory(text, integer) TO authenticated;

-- Helper: try to consume defender's anti item with a given success percent.
-- Returns true if blocked (success), false otherwise. Consumes one only on success.
CREATE OR REPLACE FUNCTION public._try_anti_block(_defender uuid, _anti_id text, _pct int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _qty int;
  _roll int;
BEGIN
  IF _defender IS NULL OR _anti_id IS NULL THEN RETURN false; END IF;
  SELECT quantity INTO _qty FROM public.inventory
    WHERE user_id = _defender AND item_type = 'anti' AND item_id = _anti_id
    FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RETURN false; END IF;

  _roll := (floor(random() * 100))::int + 1; -- 1..100
  IF _roll > _pct THEN RETURN false; END IF;

  IF _qty = 1 THEN
    DELETE FROM public.inventory
      WHERE user_id = _defender AND item_type = 'anti' AND item_id = _anti_id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
      WHERE user_id = _defender AND item_type = 'anti' AND item_id = _anti_id;
  END IF;
  RETURN true;
END;
$$;

-- 2) Patch apply_ship_damage_v2: add anti_rocket roll (60%) for rocket weapons.
CREATE OR REPLACE FUNCTION public.apply_ship_damage_v2(_ship_id uuid, _weapon_id text, _skip_fishing_check boolean DEFAULT false)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone, damage_applied integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _attacker uuid := auth.uid();
  _base_damage integer;
  _weapon_xp integer;
  _mult numeric;
  _final_damage integer;
  _result record;
  _defender uuid;
  _prev_hp integer;
  _actual_damage integer;
  _is_rocket boolean;
  _blocked boolean := false;
  _attacker_name text;
  _defender_name text;
  _rep_ends timestamptz;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT damage, COALESCE(xp,0) INTO _base_damage, _weapon_xp
    FROM public.weapons_catalog WHERE id = _weapon_id;
  IF _base_damage IS NULL THEN RAISE EXCEPTION 'Unknown weapon: %', _weapon_id; END IF;

  _mult := public.get_combat_multiplier(_attacker);
  _final_damage := GREATEST(0, FLOOR(_base_damage * _mult))::integer;

  SELECT user_id, COALESCE(hp,0), repair_ends_at
    INTO _defender, _prev_hp, _rep_ends
    FROM public.ships_owned WHERE id = _ship_id;

  _is_rocket := _weapon_id IN ('rocket_small','rocket_medium','rocket_large');

  -- Try anti_rocket defense (60%) only for rocket weapons, when defender is another player
  IF _is_rocket AND _defender IS NOT NULL AND _defender <> _attacker THEN
    _blocked := public._try_anti_block(_defender, 'anti_rocket', 60);
  END IF;

  IF _blocked THEN
    SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
    SELECT display_name INTO _defender_name FROM public.profiles WHERE id = _defender;

    -- Defender notification
    INSERT INTO public.notifications(user_id, kind, title, body, meta)
    VALUES (_defender, 'anti_block',
      '🛡️ مضاد الصواريخ صدّ هجوم!',
      'صد مضادك صاروخاً من ' || COALESCE(_attacker_name, 'لاعب'),
      jsonb_build_object('anti_id','anti_rocket','attacker_id',_attacker,'weapon_id',_weapon_id));

    -- Attacker notification
    INSERT INTO public.notifications(user_id, kind, title, body, meta)
    VALUES (_attacker, 'anti_block_attacker',
      '⚠️ تم صد صاروخك',
      'مضاد ' || COALESCE(_defender_name, 'الخصم') || ' صد صاروخك',
      jsonb_build_object('anti_id','anti_rocket','defender_id',_defender,'weapon_id',_weapon_id));

    -- Record blocked attack (0 damage)
    BEGIN
      INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
      VALUES (_attacker, _defender, _ship_id, _final_damage, 0, false, 0);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RETURN QUERY SELECT _prev_hp, false, _rep_ends, 0;
    RETURN;
  END IF;

  -- Normal damage path
  SELECT * INTO _result
  FROM public.apply_ship_damage(_ship_id, _final_damage, _skip_fishing_check);

  _actual_damage := GREATEST(0, COALESCE(_prev_hp,0) - COALESCE(_result.new_hp,0));

  IF _defender IS NOT NULL AND _defender <> _attacker THEN
    BEGIN
      INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
      VALUES (_attacker, _defender, _ship_id, _final_damage, _actual_damage, COALESCE(_result.destroyed, false), 0);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    IF _actual_damage > 0 AND _weapon_xp > 0 THEN
      UPDATE public.profiles SET xp = COALESCE(xp,0) + _weapon_xp WHERE id = _attacker;
    END IF;
  END IF;

  RETURN QUERY SELECT _result.new_hp, _result.destroyed, _result.repair_ends_at, _final_damage;
END;
$$;

-- 3) Patch launch_nuke: anti_nuke 75% block. If blocked, attacker still loses the nuke
-- (it was launched), defender consumes one anti_nuke, no ships damaged.
CREATE OR REPLACE FUNCTION public.launch_nuke(_target_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _attacker uuid := auth.uid();
  _attack_id uuid;
  _ships_hit integer := 0;
  _qty integer;
  _prot timestamptz;
  _attacker_name text;
  _target_name text;
  _total_damage bigint := 0;
  _blocked boolean := false;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF public.is_admin(_target_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN RAISE EXCEPTION 'attacker market level under 6'; END IF;
  IF NOT public.has_pvp_fleet(_attacker) THEN RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher'; END IF;
  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;
  IF NOT public.is_market_pvp_unlocked(_target_id) THEN RAISE EXCEPTION 'target is protected (market level under 6)'; END IF;
  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_id FOR UPDATE;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles SET protection_until = NULL
   WHERE id = _attacker AND protection_until IS NOT NULL AND protection_until > now();

  SELECT quantity INTO _qty FROM public.inventory
   WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no nuke in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE user_id = _attacker AND item_id = 'nuke' AND item_type = 'weapon';
  END IF;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  -- Try anti_nuke (75%)
  _blocked := public._try_anti_block(_target_id, 'anti_nuke', 75);

  IF _blocked THEN
    INSERT INTO public.notifications(user_id, kind, title, body, meta)
    VALUES (_target_id, 'anti_block',
      '🛡️ مضاد القنابل الذرية صدّ هجوماً!',
      'صد مضادك قنبلة ذرية من ' || COALESCE(_attacker_name, 'لاعب'),
      jsonb_build_object('anti_id','anti_nuke','attacker_id',_attacker));

    INSERT INTO public.notifications(user_id, kind, title, body, meta)
    VALUES (_attacker, 'anti_block_attacker',
      '⚠️ تم صد قنبلتك الذرية',
      'مضاد ' || COALESCE(_target_name, 'الخصم') || ' صد قنبلتك الذرية',
      jsonb_build_object('anti_id','anti_nuke','defender_id',_target_id));

    INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_attacker, _target_id, 0, 0, false, 0)
    RETURNING id INTO _attack_id;

    RETURN _attack_id;
  END IF;

  -- Not blocked: destroy fleet as usual
  WITH targets AS (
    SELECT id, COALESCE(hp, 0) AS old_hp
      FROM public.ships_owned
     WHERE user_id = _target_id AND in_storage = false
     FOR UPDATE
  ), upd AS (
    UPDATE public.ships_owned AS s
       SET hp = 0,
           destroyed_at = COALESCE(s.destroyed_at, now()),
           repair_ends_at = CASE WHEN s.repair_ends_at IS NULL THEN now() + interval '4 hours' ELSE s.repair_ends_at END,
           at_sea = false,
           fishing_started_at = NULL,
           stealing_target_user_id = NULL,
           stealing_target_ship_id = NULL,
           stealing_ends_at = NULL
      FROM targets t
     WHERE s.id = t.id
    RETURNING s.id, t.old_hp
  )
  SELECT COUNT(*), COALESCE(SUM(old_hp), 0) INTO _ships_hit, _total_damage FROM upd;

  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
  VALUES (_attacker, _target_id, _total_damage, _total_damage, true, 0)
  RETURNING id INTO _attack_id;

  UPDATE public.profiles
     SET last_destroyer_id = _attacker,
         last_destroyer_name = _attacker_name,
         last_destroyer_kind = 'nuke',
         last_destroyer_at = now(),
         bg_burned_until = now() + interval '7 days'
   WHERE id = _target_id;

  RETURN _attack_id;
END;
$$;

-- 4) Patch launch_ad_bomb: anti_ad_bomb 70% block.
CREATE OR REPLACE FUNCTION public.launch_ad_bomb(_target_id uuid, _video_key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _attacker uuid := auth.uid();
  _new_id uuid;
  _ships_hit integer := 0;
  _qty integer;
  _prot timestamptz;
  _attacker_name text;
  _target_name text;
  _total_damage bigint := 0;
  _blocked boolean := false;
  _attack_id uuid;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF _video_key IS NULL OR length(_video_key) = 0 THEN RAISE EXCEPTION 'video required'; END IF;
  IF public.is_admin(_target_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN RAISE EXCEPTION 'attacker market level under 6'; END IF;
  IF NOT public.has_pvp_fleet(_attacker) THEN RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher'; END IF;
  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;
  IF NOT public.is_market_pvp_unlocked(_target_id) THEN RAISE EXCEPTION 'target is protected (market level under 6)'; END IF;
  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_id FOR UPDATE;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles SET protection_until = NULL
   WHERE id = _attacker AND protection_until IS NOT NULL AND protection_until > now();

  SELECT quantity INTO _qty FROM public.inventory
   WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no ad_bomb in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  END IF;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  -- Try anti_ad_bomb (70%)
  _blocked := public._try_anti_block(_target_id, 'anti_ad_bomb', 70);

  IF _blocked THEN
    INSERT INTO public.notifications(user_id, kind, title, body, meta)
    VALUES (_target_id, 'anti_block',
      '🛡️ مضاد القنابل الإعلانية صدّ هجوماً!',
      'صد مضادك قنبلة إعلانية من ' || COALESCE(_attacker_name, 'لاعب'),
      jsonb_build_object('anti_id','anti_ad_bomb','attacker_id',_attacker));

    INSERT INTO public.notifications(user_id, kind, title, body, meta)
    VALUES (_attacker, 'anti_block_attacker',
      '⚠️ تم صد قنبلتك الإعلانية',
      'مضاد ' || COALESCE(_target_name, 'الخصم') || ' صد قنبلتك الإعلانية',
      jsonb_build_object('anti_id','anti_ad_bomb','defender_id',_target_id));

    INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_attacker, _target_id, 0, 0, false, 0)
    RETURNING id INTO _attack_id;

    -- Return a synthetic id so the client can detect "blocked" by checking ad_bombs absence
    RETURN _attack_id;
  END IF;

  -- Not blocked: destroy fleet + ad bomb as usual
  WITH targets AS (
    SELECT id, COALESCE(hp, 0) AS old_hp
      FROM public.ships_owned
     WHERE user_id = _target_id AND in_storage = false
     FOR UPDATE
  ), upd AS (
    UPDATE public.ships_owned AS s
       SET hp = 0,
           destroyed_at = COALESCE(s.destroyed_at, now()),
           repair_ends_at = CASE WHEN s.repair_ends_at IS NULL THEN now() + interval '4 hours' ELSE s.repair_ends_at END,
           at_sea = false,
           fishing_started_at = NULL,
           stealing_target_user_id = NULL,
           stealing_target_ship_id = NULL,
           stealing_ends_at = NULL
      FROM targets t
     WHERE s.id = t.id
    RETURNING s.id, t.old_hp
  )
  SELECT COUNT(*), COALESCE(SUM(old_hp), 0) INTO _ships_hit, _total_damage FROM upd;

  INSERT INTO public.ad_bombs (target_user_id, attacker_id, video_key, started_at, expires_at, active)
  VALUES (_target_id, _attacker, _video_key, now(), now() + interval '1 hour', true)
  RETURNING id INTO _new_id;

  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won, loot_coins)
  VALUES (_attacker, _target_id, _total_damage, _total_damage, true, 0);

  UPDATE public.profiles
     SET last_destroyer_id = _attacker,
         last_destroyer_name = _attacker_name,
         last_destroyer_kind = 'ad_bomb',
         last_destroyer_at = now(),
         bg_burned_until = now() + interval '7 days'
   WHERE id = _target_id;

  RETURN _new_id;
END;
$$;
