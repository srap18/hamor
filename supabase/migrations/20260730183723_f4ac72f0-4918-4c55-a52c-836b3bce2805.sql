-- ============================================================
-- NEW PVP BRACKET SYSTEM (6-15 vs 16+)
-- ============================================================

-- Count of "attack-eligible" ships at or above a given ship level.
CREATE OR REPLACE FUNCTION public.pvp_eligible_ship_count(_user_id uuid, _min_level integer)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(COUNT(*)::integer, 0)
  FROM public.ships_owned s
  LEFT JOIN public.ship_catalog sc ON sc.code = s.catalog_code
  WHERE s.user_id = _user_id
    AND COALESCE(s.in_storage, false) = false
    AND COALESCE(s.at_sea, false) = true
    AND s.fishing_started_at IS NOT NULL
    AND s.destroyed_at IS NULL
    AND (s.repair_ends_at IS NULL OR s.repair_ends_at <= now())
    AND COALESCE(s.hp, 0) > 1
    AND (s.stealing_ends_at IS NULL OR s.stealing_ends_at <= now())
    AND COALESCE(
          sc.market_level_required,
          NULLIF((regexp_match(COALESCE(s.catalog_code, ''), '^ship-lvl-([0-9]+)$'))[1]::integer, 0),
          s.template_id,
          0
        ) >= _min_level;
$$;

-- Count of owned (non-destroyed) ships at or above a level — used for the
-- DEFENDER bracket so hiding ships in storage cannot dodge the bracket.
CREATE OR REPLACE FUNCTION public.pvp_owned_ship_count(_user_id uuid, _min_level integer)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(COUNT(*)::integer, 0)
  FROM public.ships_owned s
  LEFT JOIN public.ship_catalog sc ON sc.code = s.catalog_code
  WHERE s.user_id = _user_id
    AND s.destroyed_at IS NULL
    AND COALESCE(
          sc.market_level_required,
          NULLIF((regexp_match(COALESCE(s.catalog_code, ''), '^ship-lvl-([0-9]+)$'))[1]::integer, 0),
          s.template_id,
          0
        ) >= _min_level;
$$;

-- Attacker bracket: 2 = 16+, 1 = 6-15, 0 = not eligible to attack.
CREATE OR REPLACE FUNCTION public.pvp_attack_bracket(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.pvp_eligible_ship_count(_user_id, 16) >= 3 THEN 2
    WHEN public.pvp_eligible_ship_count(_user_id, 6)  >= 3 THEN 1
    ELSE 0
  END;
$$;

-- Defender bracket: 2 = 16+, 1 = 6-15 (everyone else defaults to 1).
CREATE OR REPLACE FUNCTION public.pvp_defense_bracket(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.pvp_owned_ship_count(_user_id, 16) >= 3 THEN 2
    ELSE 1
  END;
$$;

-- Fleet count / eligibility now uses a flat ship level 6 threshold
-- (old "market level - 3" rule removed).
CREATE OR REPLACE FUNCTION public.pvp_fleet_count(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.pvp_eligible_ship_count(_user_id, 6);
$$;

CREATE OR REPLACE FUNCTION public.pvp_min_eligible_ship_level(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.pvp_eligible_ship_count(_user_id, 16) >= 3 THEN 16
    WHEN public.pvp_eligible_ship_count(_user_id, 6)  >= 3 THEN 6
    ELSE NULL
  END::integer;
$$;

-- Attacker requirement: must own 3 eligible ships (level 6+) sailing & fishing.
CREATE OR REPLACE FUNCTION public.pvp_attacker_requirement_error(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n int;
BEGIN
  IF public.pvp_attack_bracket(_user_id) = 0 THEN
    _n := public.pvp_eligible_ship_count(_user_id, 6);
    RETURN 'لا يمكنك الهجوم: تحتاج 3 سفن مؤهلة على الأقل مستواها 6 أو أعلى، مبحرة وفي وضع الصيد وغير مدمّرة (' || _n::text || '/3).';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.pvp_requirement_error(_user_id uuid, _actor_label text DEFAULT 'attacker'::text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF COALESCE(_actor_label, 'attacker') = 'attacker' THEN
    RETURN public.pvp_attacker_requirement_error(_user_id);
  END IF;
  RETURN public.pvp_defender_requirement_error(_user_id);
END $$;

-- Bracket separation replaces the old 15-level-gap protection.
-- (Name kept so every existing call site is covered automatically.)
CREATE OR REPLACE FUNCTION public.pvp_level_gap_error(_attacker uuid, _defender uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _a int; _d int;
BEGIN
  IF _attacker IS NULL OR _defender IS NULL THEN RETURN NULL; END IF;
  IF public.is_admin(_attacker) THEN RETURN NULL; END IF;

  -- Ongoing engagement: the defender may always retaliate.
  IF public.pvp_engaged(_attacker, _defender) THEN RETURN NULL; END IF;

  _a := public.pvp_attack_bracket(_attacker);
  IF _a = 0 THEN
    RETURN public.pvp_attacker_requirement_error(_attacker);
  END IF;

  _d := public.pvp_defense_bracket(_defender);

  IF _a = _d THEN RETURN NULL; END IF;

  IF _a = 1 THEN
    RETURN '🛡️ هذا اللاعب من فئة المستوى 16+ ولا يمكنك مهاجمته.' || E'\n'
        || 'فئتك الحالية: سفن المستوى 6 – 15.' || E'\n'
        || 'للانتقال إلى الفئة المتقدمة تحتاج 3 سفن مستوى 16 أو أعلى مبحرة وتصيد.';
  END IF;

  RETURN '🛡️ هذا اللاعب من فئة المستوى 6 – 15 ولا يمكنك مهاجمته.' || E'\n'
      || 'فئتك الحالية: سفن المستوى 16 فأعلى.' || E'\n'
      || 'لاعبو الفئة المتقدمة يهاجمون فئتهم فقط.';
END $$;

-- Defense-in-depth: apply the bracket rule inside the low-level damage RPC too,
-- so a direct call cannot bypass the checks done by apply_ship_damage_v2.
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer, _skip_fishing_check boolean DEFAULT false)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _owner uuid; _tpl int; _repair_secs int;
  _resulting_hp int; _resulting_repair timestamptz;
  _prot timestamptz; _attacker uuid := auth.uid();
  _prev_hp int;
  _req_error text;
  _in_storage boolean;
  _destroyed_at timestamptz;
  _target_market int;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  PERFORM public._prep_pvp_checks(_attacker);

  SELECT s.user_id, s.template_id, COALESCE(s.hp, 100),
         COALESCE(s.in_storage, false), s.destroyed_at
    INTO _owner, _tpl, _prev_hp, _in_storage, _destroyed_at
    FROM public.ships_owned s WHERE s.id = _ship_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = _attacker THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  IF _destroyed_at IS NOT NULL OR _prev_hp <= 0 THEN RAISE EXCEPTION 'ship already destroyed'; END IF;
  IF _in_storage THEN RAISE EXCEPTION 'ship in storage'; END IF;

  PERFORM public._prep_pvp_checks(_owner);

  IF NOT public.is_admin(_attacker) THEN
    _req_error := public.pvp_attacker_requirement_error(_attacker);
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;

    IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;

    _target_market := public.effective_market_level(_owner);
    IF _target_market < 6 THEN
      RAISE EXCEPTION 'target is protected (market level under 6: current=%)', _target_market;
    END IF;

    _req_error := public.pvp_level_gap_error(_attacker, _owner);
    IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;
  END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _owner;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles
     SET protection_until = NULL, shield_cooldown_until = now() + interval '2 minutes'
   WHERE id = _attacker AND protection_until IS NOT NULL;

  _repair_secs := public._ship_repair_seconds(_tpl);
  _resulting_hp := GREATEST(0, _prev_hp - GREATEST(0, _damage));
  IF _resulting_hp <= 0 THEN
    _resulting_repair := now() + make_interval(secs => _repair_secs);
    UPDATE public.ships_owned
       SET hp = 0, destroyed_at = now(), repair_ends_at = _resulting_repair,
           at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
     WHERE id = _ship_id;
    RETURN QUERY SELECT 0, true, _resulting_repair;
  ELSE
    UPDATE public.ships_owned
       SET hp = _resulting_hp,
           destroyed_at = NULL,
           repair_ends_at = NULL
     WHERE id = _ship_id;
    RETURN QUERY SELECT _resulting_hp, false, NULL::timestamptz;
  END IF;
END;
$function$;

-- UI-facing check: same rules as the enforcement path, so the target list and
-- the actual attack can never disagree.
CREATE OR REPLACE FUNCTION public.pvp_attack_check(_defender uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _err text;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not authenticated'); END IF;
  IF _defender IS NULL OR _defender = _uid THEN RETURN jsonb_build_object('ok', false, 'reason', 'invalid defender'); END IF;

  _err := public.pvp_attacker_requirement_error(_uid);
  IF _err IS NULL THEN _err := public.pvp_defender_requirement_error(_defender); END IF;
  IF _err IS NULL THEN _err := public.pvp_level_gap_error(_uid, _defender); END IF;

  RETURN jsonb_build_object(
    'ok', _err IS NULL,
    'reason', _err,
    'my_bracket', public.pvp_attack_bracket(_uid),
    'target_bracket', public.pvp_defense_bracket(_defender),
    'eligible_ships', public.pvp_eligible_ship_count(_uid, 6),
    'eligible_ships_16', public.pvp_eligible_ship_count(_uid, 16)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.pvp_eligible_ship_count(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_owned_ship_count(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_attack_bracket(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_defense_bracket(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pvp_attack_check(uuid) TO authenticated;