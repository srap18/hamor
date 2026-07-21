
-- 1) Fix ship purchase to honor per-player storage capacity
CREATE OR REPLACE FUNCTION public.buy_ship_by_code(_code text, _template_id integer, _price_coins bigint, _max_hp integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _new uuid;
  _market_level int;
  _active_count int;
  _storage_count int;
  _storage_capacity int;
  _put_in_storage boolean := false;
  _cur_coins bigint;
  _cat record;
  _required_level int;
  _stored_template int;
  _stored_hp int;
  _server_price bigint;
  _server_hp int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _cat FROM public.ship_catalog WHERE code = _code AND active = true LIMIT 1;
  IF _cat.code IS NULL THEN RAISE EXCEPTION 'unknown ship code'; END IF;

  _server_price := COALESCE(_cat.price_coins, 0);
  IF _server_price <= 0 THEN RAISE EXCEPTION 'ship not purchasable with coins'; END IF;

  _required_level := COALESCE(_cat.market_level_required, 1);
  _stored_template := COALESCE(_cat.sort_order, _template_id);
  _server_hp := CASE
    WHEN _code = 'upgrade-sub' THEN public.submarine_capacity_for_stars(1)
    WHEN _code = 'submarine' THEN COALESCE(_cat.max_hp, 100)
    ELSE COALESCE(_cat.max_hp, 100)
  END;
  _stored_hp := _server_hp;

  SELECT level INTO _market_level FROM public.user_market WHERE user_id = _uid;
  IF _market_level IS NULL THEN _market_level := 1; END IF;
  IF _required_level > _market_level THEN RAISE EXCEPTION 'market level too low'; END IF;

  SELECT COALESCE(storage_capacity, 3) INTO _storage_capacity FROM public.profiles WHERE id = _uid;
  IF _storage_capacity IS NULL THEN _storage_capacity := 3; END IF;

  SELECT COUNT(*) FILTER (WHERE NOT in_storage), COUNT(*) FILTER (WHERE in_storage)
    INTO _active_count, _storage_count
    FROM public.ships_owned WHERE user_id = _uid;

  IF _active_count >= 3 THEN
    IF _storage_count >= _storage_capacity THEN RAISE EXCEPTION 'fleet and storage full'; END IF;
    _put_in_storage := true;
  END IF;

  SELECT coins INTO _cur_coins FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _cur_coins IS NULL THEN RAISE EXCEPTION 'no profile'; END IF;
  IF _cur_coins < _server_price THEN RAISE EXCEPTION 'insufficient coins'; END IF;

  PERFORM public._mutate_currency(_uid, -_server_price, 0, 0, 0);
  PERFORM public.award_vip_cashback(_uid, _server_price, 'ship_purchase');

  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp, in_storage, stars, max_stars)
  VALUES (_uid, _stored_template, _code, false, _stored_hp, _stored_hp, _put_in_storage, 1, 1)
  RETURNING id INTO _new;

  RETURN _new;
END;
$function$;

-- 2) Gate pearl upgrade behind boss-damage requirements; no artificial DP bump
CREATE OR REPLACE FUNCTION public.dragon_pearl_upgrade()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _d record;
  _eff int;
  _dp_level int;
  _cost int;
  _new_level int;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'auth'); END IF;
  SELECT * INTO _d FROM public.dragons WHERE user_id = _uid FOR UPDATE;
  IF _d IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_dragon'); END IF;

  _dp_level := public.compute_dragon_overall_level(_d.stage, _d.dp);
  _eff := GREATEST(COALESCE(_d.pearl_level, 0), _dp_level);

  IF _eff >= 150 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'max_level');
  END IF;

  _new_level := _eff + 1;

  -- الشرط الجديد: يجب أن يكون ضرر الوحش المحقق كافياً لهذا المستوى
  IF _new_level > _dp_level THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'need_boss_damage',
      'required_level', _new_level,
      'current_dp_level', _dp_level
    );
  END IF;

  _cost := public.dragon_pearl_upgrade_cost(_eff);
  IF _cost IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_cost');
  END IF;
  IF COALESCE(_d.pearls, 0) < _cost THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'need_pearls',
                              'cost', _cost, 'have', COALESCE(_d.pearls, 0));
  END IF;

  UPDATE public.dragons
     SET pearls = pearls - _cost,
         pearl_level = _new_level,
         updated_at = now()
   WHERE user_id = _uid;

  RETURN jsonb_build_object(
    'ok', true,
    'spent', _cost,
    'level', _new_level,
    'pearls', COALESCE(_d.pearls, 0) - _cost,
    'stage', _d.stage
  );
END;
$function$;

-- 3) Backfill: revert inflated DP to what boss damage entitles the player to
-- Max achievable dp per unit total_boss_damage is with divine sword: (3/140)
-- Clamp dp downward when it exceeds the maximum possible from recorded damage.
UPDATE public.dragons
   SET dp = GREATEST(0, LEAST(dp, (COALESCE(total_boss_damage, 0) * 3) / 140))
 WHERE dp > (COALESCE(total_boss_damage, 0) * 3) / 140;

-- Recompute stage from (possibly reduced) dp
UPDATE public.dragons
   SET stage = public.dragon_stage_for_dp(dp)
 WHERE stage <> public.dragon_stage_for_dp(dp);

-- Cap pearl_level to the DP-earned level (trigger also enforces this on future writes)
UPDATE public.dragons
   SET pearl_level = public.compute_dragon_overall_level(stage, dp)
 WHERE COALESCE(pearl_level, 0) > public.compute_dragon_overall_level(stage, dp);
