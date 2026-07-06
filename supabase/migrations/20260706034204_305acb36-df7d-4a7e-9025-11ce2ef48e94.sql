
CREATE OR REPLACE FUNCTION public.skip_shield_type_cooldown(_item_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_last timestamptz;
  v_secs_left int;
  v_days int;
  v_cost int;
  v_gems int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  -- Validate item id
  IF _item_id NOT IN ('shield_1h','shield_4h','shield_1d','shield_2d','shield_7d','shield_30d') THEN
    RAISE EXCEPTION 'invalid_shield';
  END IF;

  SELECT last_activated_at INTO v_last
    FROM public.shield_type_activations
   WHERE user_id = v_user AND item_id = _item_id
   FOR UPDATE;

  IF v_last IS NULL OR v_last + interval '7 days' <= now() THEN
    -- No active cooldown
    RETURN jsonb_build_object('ok', true, 'skipped', false, 'cost', 0);
  END IF;

  v_secs_left := EXTRACT(EPOCH FROM ((v_last + interval '7 days') - now()))::int;
  v_days := GREATEST(1, CEIL(v_secs_left::numeric / 86400.0)::int);
  v_cost := v_days * 100;

  SELECT COALESCE(gems, 0) INTO v_gems FROM public.profiles WHERE id = v_user FOR UPDATE;
  IF v_gems < v_cost THEN
    RAISE EXCEPTION 'not_enough_gems:%', v_cost;
  END IF;

  PERFORM public._mutate_currency(v_user, 0, -v_cost, 0, 0);

  DELETE FROM public.shield_type_activations
   WHERE user_id = v_user AND item_id = _item_id;

  RETURN jsonb_build_object('ok', true, 'skipped', true, 'cost', v_cost, 'days', v_days);
END;
$$;

GRANT EXECUTE ON FUNCTION public.skip_shield_type_cooldown(text) TO authenticated, service_role;
