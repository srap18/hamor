
-- 1) Missing fish in the hourly price engine (they never rotted)
INSERT INTO public.fish_ship_max_level(fish_id, max_ship_level, rarity_rank)
VALUES ('silver_arowana', 33, 6), ('coral_phantom', 33, 6), ('abyss_titan', 35, 6)
ON CONFLICT (fish_id) DO NOTHING;

-- 2) Pending catch aboard a ship currently fishing (single fish type, like fishing)
CREATE OR REPLACE FUNCTION public._ship_pending_catch(_owner uuid, _ship_id uuid)
RETURNS TABLE(fish_id text, qty bigint, capacity bigint, duration int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ship public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _pool jsonb; _pool_len int; _chosen text;
  _cap bigint; _dur int; _elapsed numeric; _ratio numeric; _hp_ratio numeric := 1;
  _has_guide boolean := false; _guide_pref text;
BEGIN
  SELECT * INTO _ship FROM public.ships_owned WHERE id = _ship_id AND user_id = _owner;
  IF _ship.id IS NULL OR _ship.fishing_started_at IS NULL THEN
    RETURN QUERY SELECT NULL::text, 0::bigint, 0::bigint, 0; RETURN;
  END IF;

  SELECT * INTO _cat FROM public.ship_catalog WHERE code = _ship.catalog_code AND active = true LIMIT 1;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog
     WHERE code = ('ship-lvl-' || COALESCE(_ship.template_id, 1)) AND active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    RETURN QUERY SELECT NULL::text, 0::bigint, 0::bigint, 0; RETURN;
  END IF;

  IF COALESCE(_ship.max_hp,0) > 0 AND _ship.hp IS NOT NULL THEN
    _hp_ratio := GREATEST(0.05, LEAST(1.0, _ship.hp::numeric / _ship.max_hp::numeric));
  END IF;

  _cap := GREATEST(1, CASE
    WHEN COALESCE(_ship.catalog_code,'') IN ('submarine','upgrade-sub') OR COALESCE(_ship.template_id,0) IN (32,33)
      THEN COALESCE(_ship.max_hp, _cat.storage, 10)
    ELSE COALESCE(_cat.storage, 10)
  END);
  _cap := GREATEST(1, FLOOR(_cap * _hp_ratio)::bigint);

  _dur := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
  _elapsed := public._effective_fishing_elapsed(_owner, _ship_id, _ship.fishing_started_at, now());
  _ratio := LEAST(1, GREATEST(0, _elapsed / _dur));

  _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
  _pool_len := jsonb_array_length(_pool);
  IF _pool_len <= 0 THEN
    RETURN QUERY SELECT NULL::text, 0::bigint, _cap, _dur; RETURN;
  END IF;

  SELECT true, NULLIF(i.meta->>'preferred_fish_id','')
    INTO _has_guide, _guide_pref
  FROM public.inventory i
  WHERE i.user_id = _owner AND i.item_type = 'crew' AND i.item_id = 'guide'
    AND i.meta->>'assigned_ship_id' = _ship_id::text
    AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > now())
  LIMIT 1;
  _has_guide := COALESCE(_has_guide, false);

  IF _has_guide AND _ship.preferred_fish_id IS NOT NULL AND _ship.preferred_fish_id <> ''
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _ship.preferred_fish_id) THEN
    _chosen := _ship.preferred_fish_id;
  ELSIF _has_guide AND _guide_pref IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _guide_pref) THEN
    _chosen := _guide_pref;
  ELSE
    SELECT p.value INTO _chosen FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
    WHERE p.ord = (1 + (abs(hashtextextended(_ship_id::text || ':' || _ship.fishing_started_at::text, 71003)) % _pool_len)) LIMIT 1;
  END IF;

  RETURN QUERY SELECT _chosen, FLOOR(_cap * _ratio)::bigint, _cap, _dur;
END;
$$;

GRANT EXECUTE ON FUNCTION public._ship_pending_catch(uuid, uuid) TO authenticated, service_role;

-- 3) Preview: loot = fish aboard the target ship right now (one type)
CREATE OR REPLACE FUNCTION public.steal_mission_preview(_attacker_ship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _my public.ships_owned%ROWTYPE;
  _tgt public.ships_owned%ROWTYPE;
  _dur numeric; _ratio numeric := 0;
  _free bigint; _avail bigint; _market bigint; _allowed bigint; _a bigint;
  _pc record;
  _reason text := NULL;
BEGIN
  IF _me IS NULL THEN RETURN jsonb_build_object('ok', false, 'count', 0, 'reason', 'not authenticated'); END IF;

  SELECT * INTO _my FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _me;
  IF _my.id IS NULL OR _my.stealing_target_ship_id IS NULL OR _my.stealing_ends_at IS NULL OR _my.stealing_started_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'count', 0, 'reason', 'no active steal mission');
  END IF;

  _dur := GREATEST(1, EXTRACT(EPOCH FROM (_my.stealing_ends_at - _my.stealing_started_at)));
  _ratio := LEAST(1, GREATEST(0, EXTRACT(EPOCH FROM (now() - _my.stealing_started_at)) / _dur));

  SELECT * INTO _tgt FROM public.ships_owned WHERE id = _my.stealing_target_ship_id;
  IF _tgt.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'count', 0, 'ratio', _ratio, 'reason', 'target_gone');
  END IF;

  SELECT * INTO _pc FROM public._ship_pending_catch(_tgt.user_id, _tgt.id);

  _free   := GREATEST(0, public._ship_fish_capacity(_attacker_ship_id));
  _avail  := GREATEST(0, COALESCE(_pc.qty, 0));
  _market := public.user_market_remaining(_me);

  _a := LEAST(_free, _avail);
  _allowed := FLOOR(_a * _ratio)::bigint;
  _allowed := LEAST(_allowed, _free, _avail, _market);
  IF _allowed < 0 THEN _allowed := 0; END IF;

  IF _allowed <= 0 THEN
    IF _avail <= 0 THEN _reason := 'target_empty';
    ELSIF _free <= 0 THEN _reason := 'hold_full';
    ELSIF _market <= 0 THEN _reason := 'market_full';
    ELSE _reason := 'too_early';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'count', _allowed, 'ratio', _ratio,
    'free', _free, 'avail', _avail, 'market', _market,
    'fish_id', _pc.fish_id, 'reason', _reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.steal_mission_preview(uuid) TO authenticated, service_role;

-- 4) Settle: move a single fish type off the target's in-progress catch
CREATE OR REPLACE FUNCTION public._settle_steal_mission(_attacker_ship_id uuid, _reason text)
RETURNS TABLE(stolen_count integer, total_value bigint, fish_summary jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _my public.ships_owned%ROWTYPE;
  _tgt public.ships_owned%ROWTYPE;
  _ratio numeric := 0;
  _dur numeric;
  _free bigint; _avail bigint; _market bigint; _allowed bigint; _a bigint;
  _pc record;
  _unit bigint := 0;
  _shift numeric;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('steal_mission:' || _attacker_ship_id::text, 0));

  SELECT * INTO _my FROM public.ships_owned
   WHERE id = _attacker_ship_id AND user_id = _me FOR UPDATE;
  IF _my.id IS NULL THEN RAISE EXCEPTION 'no active steal mission'; END IF;
  IF _my.stealing_target_ship_id IS NULL OR _my.stealing_ends_at IS NULL OR _my.stealing_started_at IS NULL THEN
    RAISE EXCEPTION 'no active steal mission';
  END IF;

  _dur := GREATEST(1, EXTRACT(EPOCH FROM (_my.stealing_ends_at - _my.stealing_started_at)));
  _ratio := LEAST(1, GREATEST(0, EXTRACT(EPOCH FROM (now() - _my.stealing_started_at)) / _dur));

  IF _reason = 'claim' AND _ratio < 1 THEN
    RAISE EXCEPTION 'mission not finished';
  END IF;

  SELECT * INTO _tgt FROM public.ships_owned
   WHERE id = _my.stealing_target_ship_id FOR UPDATE;

  UPDATE public.ships_owned
     SET stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_started_at = NULL,
         stealing_ends_at = NULL,
         at_sea = false
   WHERE id = _attacker_ship_id;

  IF _tgt.id IS NULL THEN
    RETURN QUERY SELECT 0, 0::bigint, '[]'::jsonb; RETURN;
  END IF;

  SELECT * INTO _pc FROM public._ship_pending_catch(_tgt.user_id, _tgt.id);

  _free   := GREATEST(0, public._ship_fish_capacity(_attacker_ship_id));
  _avail  := GREATEST(0, COALESCE(_pc.qty, 0));
  _market := public.user_market_remaining(_me);

  _a := LEAST(_free, _avail);
  _allowed := FLOOR(_a * _ratio)::bigint;
  _allowed := LEAST(_allowed, _free, _avail, _market);

  IF _allowed <= 0 OR _pc.fish_id IS NULL THEN
    RETURN QUERY SELECT 0, 0::bigint, '[]'::jsonb; RETURN;
  END IF;

  SELECT COALESCE(current_price, 0)::bigint INTO _unit
    FROM public.fish_market_prices WHERE fish_market_prices.fish_id = _pc.fish_id LIMIT 1;

  INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
  VALUES (_me, _pc.fish_id, _attacker_ship_id, now(), COALESCE(_unit, 0), _allowed);

  -- Deduct the stolen amount from the target's in-progress catch
  IF COALESCE(_pc.capacity, 0) > 0 AND COALESCE(_pc.duration, 0) > 0 THEN
    _shift := (_allowed::numeric / _pc.capacity::numeric) * _pc.duration::numeric;
    UPDATE public.ships_owned
       SET fishing_started_at = LEAST(now(), fishing_started_at + make_interval(secs => _shift))
     WHERE id = _tgt.id AND fishing_started_at IS NOT NULL;
  END IF;

  RETURN QUERY SELECT _allowed::int, (_allowed * COALESCE(_unit,0))::bigint,
    jsonb_build_array(jsonb_build_object('fish_id', _pc.fish_id, 'qty', _allowed, 'value', _allowed * COALESCE(_unit,0)));
END;
$$;
