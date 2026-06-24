
CREATE OR REPLACE FUNCTION public.boss_hit_my_ship(p_ship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_ship public.ships_owned%ROWTYPE;
  v_level int;
  v_max int;
  v_hits int;
  v_dmg int;
  v_new_hp int;
  v_destroyed boolean := false;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  -- Only allow while an active boss exists.
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

  -- Already destroyed: nothing to do.
  IF v_ship.destroyed_at IS NOT NULL OR COALESCE(v_ship.hp, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'new_hp', 0, 'max_hp', COALESCE(v_ship.max_hp, 0), 'destroyed', true);
  END IF;

  -- Resolve ship tier (market_level_required) from catalog, fallback to template_id.
  SELECT COALESCE(c.market_level_required, v_ship.template_id, 1), COALESCE(v_ship.max_hp, c.max_hp, 100)
    INTO v_level, v_max
  FROM public.ship_catalog c
  WHERE c.code = v_ship.catalog_code;
  IF v_level IS NULL THEN
    v_level := COALESCE(v_ship.template_id, 1);
    v_max   := COALESCE(v_ship.max_hp, 100);
  END IF;

  -- Stronger ships take more hits before sinking: 4 → 10+ hits.
  v_hits := GREATEST(4, 4 + (v_level / 3));
  v_dmg  := GREATEST(1, CEIL(v_max::numeric / v_hits)::int);
  v_new_hp := GREATEST(0, COALESCE(v_ship.hp, v_max) - v_dmg);
  v_destroyed := (v_new_hp = 0);

  UPDATE public.ships_owned
     SET hp = v_new_hp,
         destroyed_at = CASE WHEN v_destroyed AND destroyed_at IS NULL THEN now() ELSE destroyed_at END
   WHERE id = p_ship_id;

  RETURN jsonb_build_object(
    'ok', true,
    'damage', v_dmg,
    'new_hp', v_new_hp,
    'max_hp', v_max,
    'destroyed', v_destroyed,
    'hits_to_destroy', v_hits
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.boss_hit_my_ship(uuid) TO authenticated;
