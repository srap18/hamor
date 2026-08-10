CREATE TABLE IF NOT EXISTS public.attack_cadence (
  user_id uuid PRIMARY KEY,
  samples timestamptz[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.attack_cadence TO service_role;
ALTER TABLE public.attack_cadence ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._guard_attack_cadence(_action text DEFAULT 'attack')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _s timestamptz[];
  _n int;
  _burst int;
  _avg numeric;
  _sd numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT samples INTO _s FROM public.attack_cadence WHERE user_id = _uid FOR UPDATE;
  _s := COALESCE(_s, '{}'::timestamptz[]);
  _n := COALESCE(array_length(_s, 1), 0);

  IF _n > 0 AND (now() - _s[_n]) < interval '300 milliseconds' THEN
    INSERT INTO public.cheat_flags (user_id, kind, severity, details)
    VALUES (_uid, 'script_burst', 3, jsonb_build_object('action', _action));
    RAISE EXCEPTION 'too_fast' USING ERRCODE = '54000';
  END IF;

  SELECT count(*) INTO _burst FROM unnest(_s) AS t WHERE t > now() - interval '10 seconds';
  IF _burst >= 20 THEN
    INSERT INTO public.cheat_flags (user_id, kind, severity, details)
    VALUES (_uid, 'script_burst', 3, jsonb_build_object('action', _action, 'in_10s', _burst));
    RAISE EXCEPTION 'too_fast' USING ERRCODE = '54000';
  END IF;

  _s := _s || now();
  _n := array_length(_s, 1);
  IF _n > 15 THEN
    _s := _s[(_n - 14):_n];
    _n := 15;
  END IF;

  IF _n >= 10 THEN
    SELECT avg(d), stddev_samp(d) INTO _avg, _sd
      FROM (
        SELECT EXTRACT(EPOCH FROM (_s[i] - _s[i-1])) * 1000 AS d
          FROM generate_series(2, _n) AS i
      ) q;
    IF _avg IS NOT NULL AND _avg < 3000 AND COALESCE(_sd, 999) < 75 THEN
      INSERT INTO public.cheat_flags (user_id, kind, severity, details)
      VALUES (_uid, 'bot_cadence', 3, jsonb_build_object('action', _action, 'avg_ms', round(_avg), 'sd_ms', round(COALESCE(_sd,0))));
      RAISE EXCEPTION 'bot_detected' USING ERRCODE = '54000';
    END IF;
  END IF;

  INSERT INTO public.attack_cadence (user_id, samples, updated_at)
  VALUES (_uid, _s, now())
  ON CONFLICT (user_id) DO UPDATE SET samples = EXCLUDED.samples, updated_at = now();
END;
$fn$;

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
  _target_market int;
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

  -- Unified attacker requirements (market lvl, fleet, fishing state) — same as nuke/ad_bomb
  _req_error := public.pvp_attacker_requirement_error(_attacker);
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;

  IF public.attacker_has_destroyed_ship(_attacker) THEN RAISE EXCEPTION 'attacker has destroyed ship'; END IF;

  -- Unified defender check
  _req_error := public.pvp_defender_requirement_error(_defender);
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION 'target is protected (%)', _req_error; END IF;

  -- CRITICAL: level-gap protection — must apply to rockets too, not only nuke/ad_bomb
  _req_error := public.pvp_pair_block_error(_attacker, _defender);
  IF _req_error IS NOT NULL THEN RAISE EXCEPTION '%', _req_error; END IF;

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