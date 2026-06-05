CREATE OR REPLACE FUNCTION public.award_dragon_dp(p_damage bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_dragon dragons%ROWTYPE;
  v_has_eternal_sword boolean;
  v_dp_gain bigint;
  v_new_stage int;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF p_damage IS NULL OR p_damage <= 0 THEN
    RETURN jsonb_build_object('dp_gain', 0);
  END IF;

  INSERT INTO dragons(user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT * INTO v_dragon FROM dragons WHERE user_id = v_user FOR UPDATE;

  SELECT EXISTS(
    SELECT 1 FROM dragon_equipment
    WHERE user_id = v_user AND slot = 'weapon'
      AND equipped = true AND rarity = 'divine'
  ) INTO v_has_eternal_sword;

  IF v_has_eternal_sword THEN
    v_dp_gain := (p_damage * 3) / 2000;
  ELSE
    v_dp_gain := p_damage / 1000;
  END IF;

  IF v_dp_gain < 1 THEN v_dp_gain := 0; END IF;

  UPDATE dragons SET
    dp = dp + v_dp_gain,
    total_boss_damage = total_boss_damage + p_damage,
    updated_at = now()
  WHERE user_id = v_user
  RETURNING * INTO v_dragon;

  v_new_stage := CASE
    WHEN v_dragon.dp >= 3500000 THEN 15
    WHEN v_dragon.dp >= 1600000 THEN 14
    WHEN v_dragon.dp >= 800000  THEN 13
    WHEN v_dragon.dp >= 400000  THEN 12
    WHEN v_dragon.dp >= 200000  THEN 11
    WHEN v_dragon.dp >= 100000  THEN 10
    WHEN v_dragon.dp >= 50000   THEN 9
    WHEN v_dragon.dp >= 25000   THEN 8
    WHEN v_dragon.dp >= 12000   THEN 7
    WHEN v_dragon.dp >= 5000    THEN 6
    WHEN v_dragon.dp >= 2000    THEN 5
    WHEN v_dragon.dp >= 800     THEN 4
    WHEN v_dragon.dp >= 300     THEN 3
    WHEN v_dragon.dp >= 100     THEN 2
    ELSE 1
  END;

  IF v_new_stage <> v_dragon.stage THEN
    UPDATE dragons SET stage = v_new_stage, updated_at = now()
    WHERE user_id = v_user
    RETURNING * INTO v_dragon;
  END IF;

  RETURN jsonb_build_object(
    'dp_gain', v_dp_gain,
    'dp', v_dragon.dp,
    'stage', v_dragon.stage
  );
END;
$function$;