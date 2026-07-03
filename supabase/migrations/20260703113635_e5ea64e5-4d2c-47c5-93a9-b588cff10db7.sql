-- 1) Add opt-out flag: when TRUE, golden_fisher_until does NOT confer PvP shield.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS golden_fisher_no_shield boolean NOT NULL DEFAULT false;

-- 2) drop_my_protection: clear shield AND opt out of golden-fisher-implied shield.
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
         golden_fisher_no_shield = true,
         shield_cooldown_until = now() + interval '2 minutes'
   WHERE id = auth.uid();
END;
$function$;

-- 3) activate_golden_fisher: re-enable shield when a new/extended activation happens.
CREATE OR REPLACE FUNCTION public.activate_golden_fisher()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record; _current timestamptz; _new_until timestamptz; _base timestamptz;
  _had_inventory boolean := false; _tick jsonb; _is_admin boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM public._require_market_level(10);

  SELECT public.has_role(_uid, 'admin'::public.app_role) INTO _is_admin;
  _is_admin := COALESCE(_is_admin, false);

  SELECT golden_fisher_until INTO _current FROM public.profiles WHERE id = _uid FOR UPDATE;

  SELECT * INTO _row FROM public.inventory
   WHERE user_id = _uid AND item_type = 'crew' AND item_id = 'golden_fisher'
     AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL) AND quantity > 0
   ORDER BY acquired_at ASC FOR UPDATE LIMIT 1;

  IF _row.id IS NOT NULL THEN
    _had_inventory := true;
    IF _row.quantity <= 1 THEN DELETE FROM public.inventory WHERE id = _row.id;
    ELSE UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id; END IF;
    _base := GREATEST(COALESCE(_current, now()), now());
    _new_until := _base + interval '24 hours';
  ELSE
    IF _is_admin THEN
      _base := GREATEST(COALESCE(_current, now()), now());
      _new_until := _base + interval '24 hours';
    ELSIF _current IS NULL OR _current <= now() THEN
      RAISE EXCEPTION 'no_golden_fisher_in_inventory';
    ELSE
      _new_until := _current;
    END IF;
  END IF;

  UPDATE public.profiles
     SET golden_fisher_until = _new_until,
         golden_fisher_last_activated_at = now(),
         golden_fisher_no_shield = false,  -- fresh activation restores shield by default
         protection_until = GREATEST(COALESCE(protection_until, _new_until), _new_until)
   WHERE id = _uid;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL,
         stealing_ends_at = NULL, stealing_started_at = NULL
   WHERE stealing_target_user_id = _uid;

  UPDATE public.ships_owned s
     SET at_sea = true, fishing_started_at = now(), last_fishing_reward_at = now()
    FROM public.ship_catalog c
   WHERE c.code = s.catalog_code
     AND s.user_id = _uid AND s.in_storage = false AND s.destroyed_at IS NULL
     AND (s.repair_ends_at IS NULL OR s.repair_ends_at <= now())
     AND s.stealing_target_user_id IS NULL AND s.stealing_ends_at IS NULL
     AND (COALESCE(s.at_sea, false) = false OR s.fishing_started_at IS NULL);

  UPDATE public.ships_owned
     SET at_sea = true
   WHERE user_id = _uid AND in_storage = false AND destroyed_at IS NULL
     AND (repair_ends_at IS NULL OR repair_ends_at <= now())
     AND stealing_target_user_id IS NULL AND stealing_ends_at IS NULL
     AND fishing_started_at IS NOT NULL AND COALESCE(at_sea, false) = false;

  _tick := public.golden_fisher_tick(_uid);

  RETURN jsonb_build_object(
    'ok', true,
    'already_active', (_current IS NOT NULL AND _current > now() AND NOT _had_inventory),
    'extended', _had_inventory,
    'admin_test', (_is_admin AND NOT _had_inventory),
    'until', _new_until,
    'tick', _tick
  );
END;
$function$;

-- 4) record_attack: golden_fisher_until only shields when opt-out flag is FALSE.
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
  _def_gf_no_shield boolean;
  _mult numeric;
  _req_error text;
  _gf_shields boolean;
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

  -- Attacker loses their own shield when initiating an attack.
  -- Do NOT clear golden_fisher_until (keeps auto-fishing running).
  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = _uid
     AND protection_until IS NOT NULL AND protection_until > now();

  _mult := public.get_combat_multiplier(_uid);
  _damage := LEAST(10000000, GREATEST(0, FLOOR(_damage::numeric * _mult)::int));
  _damage_dealt := LEAST(_damage, GREATEST(0, FLOOR(_damage_dealt::numeric * _mult)::int));
  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins, xp_gain)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0, _xp)
    RETURNING id INTO _id;
  RETURN _id;
END
$function$;

-- 5) start_steal_mission: same rule — golden_fisher shields only if flag is off.
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
  _secs integer;
  _ends timestamptz;
  _started timestamptz := now();
  _attacker_name text;
  _attacker_emoji text;
  _target_protection timestamptz;
  _target_golden_until timestamptz;
  _target_gf_no_shield boolean;
  _target_gf_shields boolean;
  _req_error text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _target_user_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;
  IF public.is_admin(_target_user_id) THEN RAISE EXCEPTION 'target is a staff account (protected)'; END IF;

  PERFORM public._prep_pvp_checks(_me);
  PERFORM public._prep_pvp_checks(_target_user_id);

  _req_error := public.pvp_requirement_error(_me, 'attacker');
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
  _req_error := public.pvp_requirement_error(_target_user_id, 'target');
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%).', _req_error; END IF;

  IF NOT public.is_admin(_me) AND public.users_same_device(_me, _target_user_id) THEN
    RAISE EXCEPTION 'blocked: cannot steal from an account on the same device';
  END IF;

  -- Attacker's own shield ends when initiating theft (keep golden fisher running).
  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = _me AND protection_until IS NOT NULL;

  SELECT protection_until, public.golden_fisher_active_until(id), COALESCE(golden_fisher_no_shield, false)
    INTO _target_protection, _target_golden_until, _target_gf_no_shield
  FROM public.profiles
  WHERE id = _target_user_id
  FOR UPDATE;

  _target_gf_shields := (_target_golden_until IS NOT NULL AND _target_golden_until > now() AND NOT _target_gf_no_shield);

  IF (_target_protection IS NOT NULL AND _target_protection > now()) OR _target_gf_shields THEN
    IF _target_gf_shields THEN
      UPDATE public.profiles
         SET protection_until = GREATEST(COALESCE(protection_until, now()), COALESCE(_target_golden_until, protection_until, now()))
       WHERE id = _target_user_id;
    END IF;
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

  -- Delegate to existing internal continuation (unchanged trailing logic).
  IF _my_ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = _my_ship.catalog_code AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = ('ship-lvl-' || COALESCE(_my_ship.template_id, 1)) AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog WHERE sort_order = COALESCE(_my_ship.template_id, 1) AND active = true LIMIT 1;
  END IF;

  _secs := GREATEST(60, COALESCE(_cat.duration_seconds, 300));
  _ends := _started + make_interval(secs => _secs);

  UPDATE public.ships_owned
     SET stealing_target_user_id = _target_user_id,
         stealing_target_ship_id = _target_ship_id,
         stealing_started_at = _started,
         stealing_ends_at = _ends,
         at_sea = true,
         fishing_started_at = _started
   WHERE id = _attacker_ship_id;

  SELECT display_name, avatar_emoji INTO _attacker_name, _attacker_emoji
    FROM public.profiles WHERE id = _me;

  INSERT INTO public.notifications(user_id, kind, title, body, meta)
    VALUES (_target_user_id, 'steal_incoming',
            'محاولة سرقة!',
            COALESCE(_attacker_name, 'قرصان') || ' يحاول سرقة أسماك سفينتك',
            jsonb_build_object(
              'attacker_id', _me,
              'attacker_name', _attacker_name,
              'attacker_emoji', _attacker_emoji,
              'target_ship_id', _target_ship_id,
              'ends_at', _ends
            ));

  RETURN QUERY SELECT _ends;
END
$function$;