CREATE OR REPLACE FUNCTION public.boss_hit_my_ship(p_ship_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_ship public.ships_owned%ROWTYPE;
  v_level int;
  v_max int;
  v_hits int;
  v_dmg int;
  v_new_hp int;
  v_destroyed boolean := false;
  v_repair_secs int;
  v_repair_ends timestamptz;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  PERFORM 1 FROM public.world_boss
    WHERE defeated_at IS NULL AND expires_at > now() AND hp_current > 0
    LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_active_boss');
  END IF;

  SELECT * INTO v_ship FROM public.ships_owned
    WHERE id = p_ship_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ship_not_found');
  END IF;

  -- Protect destroyed ships: cannot be hit again.
  IF v_ship.destroyed_at IS NOT NULL OR COALESCE(v_ship.hp, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ship_destroyed',
      'new_hp', 0, 'max_hp', COALESCE(v_ship.max_hp, 0), 'destroyed', true);
  END IF;

  -- Protect ships that are not at sea (stopped fishing) or in storage.
  IF COALESCE(v_ship.in_storage, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ship_in_storage');
  END IF;
  IF NOT COALESCE(v_ship.at_sea, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ship_not_at_sea');
  END IF;

  SELECT COALESCE(c.market_level_required, v_ship.template_id, 1), COALESCE(v_ship.max_hp, c.max_hp, 100)
    INTO v_level, v_max
  FROM public.ship_catalog c
  WHERE c.code = v_ship.catalog_code;
  IF v_level IS NULL THEN
    v_level := COALESCE(v_ship.template_id, 1);
    v_max   := COALESCE(v_ship.max_hp, 100);
  END IF;

  v_hits := GREATEST(4, 4 + (v_level / 3));
  v_dmg  := GREATEST(1, CEIL(v_max::numeric / v_hits)::int);
  v_new_hp := GREATEST(0, COALESCE(v_ship.hp, v_max) - v_dmg);
  v_destroyed := (v_new_hp = 0);

  IF v_destroyed THEN
    v_level := LEAST(30, GREATEST(1, COALESCE(v_ship.template_id, v_level, 1)));
    v_repair_secs := ROUND(60 + (v_level - 1) * (14400 - 60) / 29.0)::int;
    v_repair_ends := now() + make_interval(secs => v_repair_secs);
    UPDATE public.ships_owned
       SET hp = 0,
           destroyed_at = COALESCE(destroyed_at, now()),
           repair_ends_at = COALESCE(repair_ends_at, v_repair_ends),
           at_sea = false,
           fishing_started_at = NULL,
           stealing_target_user_id = NULL,
           stealing_target_ship_id = NULL,
           stealing_ends_at = NULL
     WHERE id = p_ship_id;
  ELSE
    UPDATE public.ships_owned
       SET hp = v_new_hp
     WHERE id = p_ship_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'damage', v_dmg,
    'new_hp', v_new_hp,
    'max_hp', v_max,
    'destroyed', v_destroyed,
    'hits_to_destroy', v_hits
  );
END;
$function$;