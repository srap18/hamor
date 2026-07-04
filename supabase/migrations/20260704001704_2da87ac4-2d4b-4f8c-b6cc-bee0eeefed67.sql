CREATE OR REPLACE FUNCTION public.submit_message_report(
  _reported_user_id uuid,
  _kind text,
  _source_id text DEFAULT NULL,
  _message_body text DEFAULT '',
  _reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _reporter uuid := auth.uid();
  _id uuid;
BEGIN
  IF _reporter IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _reported_user_id IS NULL THEN RAISE EXCEPTION 'missing_reported_user'; END IF;
  IF _reported_user_id = _reporter THEN RAISE EXCEPTION 'cannot_report_self'; END IF;
  IF _kind NOT IN ('chat', 'ad_bomb', 'destroyer') THEN RAISE EXCEPTION 'bad_report_kind'; END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _reporter AND COALESCE(p.reports_disabled, false) = true) THEN
    RAISE EXCEPTION 'reports_disabled';
  END IF;

  INSERT INTO public.message_reports(reporter_id, reported_user_id, kind, source_id, message_body, reason)
  VALUES (_reporter, _reported_user_id, _kind, NULLIF(_source_id, ''), LEFT(COALESCE(_message_body, ''), 2000), NULLIF(LEFT(BTRIM(COALESCE(_reason, '')), 400), ''))
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_message_report(uuid, text, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sell_fish_by_qty(_fish_id text, _qty integer, _client_version text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _total bigint := 0;
  _quoted_sold integer := 0;
  _sold integer := 0;
  _remaining integer := 0;
  _current_price numeric := 0;
  _rot numeric := 1;
  _effective_unit_price numeric := 0;
  _balance_before bigint := 0;
  _stock_id uuid;
  _stock_qty integer;
  _take integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _client_version IS DISTINCT FROM 'fish-market-v20260626-force-update-1' THEN
    RAISE EXCEPTION 'update_required: حدث اللعبة ثم حاول مرة ثانية' USING ERRCODE = 'P0001';
  END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RETURN 0; END IF;

  SET LOCAL lock_timeout = '2500ms';
  PERFORM set_config('app.audit_source', 'sell_fish_by_qty', true);
  PERFORM set_config('app.audit_reason', 'fish_sale_fast', true);
  PERFORM public._enforce_rate_limit('sell_fish', 500);
  PERFORM pg_advisory_xact_lock(hashtextextended('sell_fish:' || _uid::text, 0));

  SELECT q.sold, q.total_amount, q.effective_unit_price, q.current_price, q.rot
    INTO _quoted_sold, _total, _effective_unit_price, _current_price, _rot
    FROM public.quote_fish_sale_by_qty(_fish_id, _qty) q;
  IF COALESCE(_quoted_sold, 0) <= 0 OR COALESCE(_total, 0) <= 0 THEN RETURN 0; END IF;

  _remaining := _quoted_sold;
  WHILE _remaining > 0 LOOP
    SELECT fs.id, fs.quantity INTO _stock_id, _stock_qty
      FROM public.fish_stock fs
     WHERE fs.user_id = _uid AND fs.fish_id = _fish_id AND fs.quantity > 0
     ORDER BY fs.caught_at ASC, fs.id ASC
     LIMIT 1 FOR UPDATE;
    IF _stock_id IS NULL OR COALESCE(_stock_qty, 0) <= 0 THEN EXIT; END IF;
    _take := LEAST(_stock_qty, _remaining);
    IF _take >= _stock_qty THEN
      DELETE FROM public.fish_stock WHERE id = _stock_id;
    ELSE
      UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = _stock_id;
    END IF;
    _sold := _sold + _take;
    _remaining := _remaining - _take;
    _stock_id := NULL;
    _stock_qty := NULL;
  END LOOP;

  IF COALESCE(_sold, 0) <= 0 THEN RETURN 0; END IF;
  _total := GREATEST(0, ROUND(_effective_unit_price * _sold))::bigint;
  IF _total <= 0 THEN RETURN 0; END IF;

  SELECT coins INTO _balance_before FROM public.profiles WHERE id = _uid FOR UPDATE;
  INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
  VALUES (_uid, _fish_id, 0, _sold)
  ON CONFLICT (user_id, fish_id)
  DO UPDATE SET quantity = GREATEST(0, public.fish_caught.quantity - EXCLUDED.total_caught), updated_at = now();

  PERFORM public._mutate_currency(_uid, _total, 0, 0, 0);
  IF _total >= 100000 THEN
    INSERT INTO public.transaction_logs(user_id, kind, item_id, quantity, unit_price, total_amount, balance_before, balance_after, meta)
    VALUES (_uid, 'fish_sale', _fish_id, _sold, GREATEST(0, ROUND(_effective_unit_price))::bigint, _total, COALESCE(_balance_before, 0), COALESCE(_balance_before, 0) + _total,
      jsonb_build_object('requested_qty', _qty, 'current_price', _current_price, 'rot', _rot, 'effective_unit_price', _effective_unit_price, 'client_version', _client_version, 'sale_mode', 'single_fast'));
  END IF;
  RETURN _total;
END;
$$;

CREATE OR REPLACE FUNCTION public.golden_fisher_tick(_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _ship record; _pool jsonb; _pool_len int; _chosen text; _qty bigint; _unit_value bigint;
  _ships_processed int := 0; _total_cycles int := 0; _ships_launched int := 0; _total_fish bigint := 0;
  _now timestamptz := now(); _elapsed numeric; _duration int; _active_until timestamptz;
  _luck_mult int; _has_luck boolean; _has_guide boolean; _guide_pref text; _ship_preferred text;
  _hp_ratio numeric; _market_remaining bigint; _cycles int; _last_at timestamptz; _market_full boolean := false;
  _lock_key bigint; _slot_key bigint; _ship_locked record; _new_last_at timestamptz; _inserted_slots int; _last_inserted_slot bigint;
  _t_start timestamptz; _capacity bigint; _attempt int; _retry boolean; _resolved_code text; _paused boolean;
BEGIN
  IF _user IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'missing_user'); END IF;
  _lock_key := hashtextextended('golden_fisher:' || _user::text, 0);
  IF NOT pg_try_advisory_xact_lock(_lock_key) THEN RETURN jsonb_build_object('ok', false, 'reason', 'locked'); END IF;
  SET LOCAL lock_timeout = '2500ms';

  SELECT public.golden_fisher_active_until(_user), COALESCE(golden_fisher_paused, false) INTO _active_until, _paused FROM public.profiles WHERE id = _user;
  IF _active_until IS NULL OR _active_until <= _now THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_active'); END IF;
  IF COALESCE(_paused, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'paused'); END IF;

  UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL, stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL, stealing_started_at = NULL
   WHERE stealing_target_user_id = _user OR (user_id = _user AND stealing_target_user_id IS NOT NULL);

  _market_remaining := public.user_market_remaining(_user);
  IF _market_remaining <= 0 THEN
    UPDATE public.ships_owned SET at_sea = true, fishing_started_at = COALESCE(fishing_started_at, _now), last_fishing_reward_at = COALESCE(last_fishing_reward_at, fishing_started_at, _now)
     WHERE user_id = _user AND COALESCE(in_storage, false) = false AND stealing_target_user_id IS NULL AND stealing_ends_at IS NULL
       AND (COALESCE(max_hp, 0) <= 0 OR COALESCE(hp, max_hp, 1)::numeric / GREATEST(max_hp, 1)::numeric >= 0.30);
    RETURN jsonb_build_object('ok', true, 'ships_processed', 0, 'launched', 0, 'cycles', 0, 'fish_added', 0, 'waiting_for_space', 1, 'market_full', true);
  END IF;

  FOR _ship IN SELECT s.id FROM public.ships_owned s WHERE s.user_id = _user AND COALESCE(s.in_storage, false) = false AND s.stealing_target_user_id IS NULL AND s.stealing_ends_at IS NULL ORDER BY s.acquired_at NULLS LAST, s.id LOOP
    _attempt := 0; _retry := true;
    WHILE _retry AND _attempt < 3 LOOP
      _attempt := _attempt + 1; _retry := false; _t_start := clock_timestamp(); _cycles := 0; _qty := 0;
      BEGIN
        _market_remaining := public.user_market_remaining(_user);
        IF _market_remaining <= 0 THEN _market_full := true; EXIT; END IF;
        SELECT s.* INTO _ship_locked FROM public.ships_owned s WHERE s.id = _ship.id FOR UPDATE OF s SKIP LOCKED;
        IF _ship_locked.id IS NULL OR COALESCE(_ship_locked.in_storage, false) OR _ship_locked.stealing_target_user_id IS NOT NULL OR _ship_locked.stealing_ends_at IS NOT NULL THEN EXIT; END IF;

        _resolved_code := COALESCE(NULLIF(_ship_locked.catalog_code,''), 'ship-lvl-' || COALESCE(_ship_locked.template_id,1)::text);
        IF NOT EXISTS (SELECT 1 FROM public.ship_catalog c WHERE c.active AND c.code = _resolved_code) THEN
          _resolved_code := CASE COALESCE(_ship_locked.template_id, 0) WHEN 31 THEN 'phoenix' WHEN 32 THEN 'submarine' WHEN 33 THEN 'upgrade-sub' ELSE _resolved_code END;
        END IF;
        SELECT c.fish_pool, c.fishing_seconds, c.storage, c.fishing_power INTO _pool, _duration, _capacity, _qty FROM public.ship_catalog c WHERE c.active = true AND c.code = _resolved_code LIMIT 1;
        IF _pool IS NULL THEN UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL, last_fishing_reward_at = NULL WHERE id = _ship_locked.id; EXIT; END IF;

        _hp_ratio := CASE WHEN COALESCE(_ship_locked.max_hp,0) > 0 THEN COALESCE(_ship_locked.hp,_ship_locked.max_hp)::numeric / _ship_locked.max_hp::numeric ELSE 1 END;
        IF _hp_ratio < 0.30 THEN UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL WHERE id = _ship_locked.id; EXIT; END IF;
        _hp_ratio := GREATEST(0.05, LEAST(1.0, _hp_ratio));
        _duration := GREATEST(30, COALESCE(_duration, 600));

        IF NOT COALESCE(_ship_locked.at_sea, false) OR _ship_locked.fishing_started_at IS NULL THEN
          UPDATE public.ships_owned SET at_sea = true, fishing_started_at = _now, last_fishing_reward_at = NULL WHERE id = _ship_locked.id;
          _ships_launched := _ships_launched + 1; EXIT;
        END IF;

        _last_at := GREATEST(COALESCE(_ship_locked.last_fishing_reward_at, _ship_locked.fishing_started_at), _ship_locked.fishing_started_at);
        _elapsed := public._effective_fishing_elapsed(_user, _ship_locked.id, _last_at, _now);
        _cycles := LEAST(1, FLOOR(_elapsed / _duration)::int);
        IF _cycles <= 0 THEN UPDATE public.ships_owned SET at_sea = true WHERE id = _ship_locked.id; EXIT; END IF;
        _new_last_at := _now;

        _inserted_slots := 0; _last_inserted_slot := NULL;
        FOR _slot_key IN FLOOR(EXTRACT(EPOCH FROM _last_at))::bigint + 1 .. FLOOR(EXTRACT(EPOCH FROM _last_at))::bigint + _cycles LOOP
          BEGIN
            INSERT INTO public.golden_fisher_rewards(ship_id, reward_slot, user_id, qty) VALUES (_ship_locked.id, _slot_key, _user, 0);
            _inserted_slots := _inserted_slots + 1; _last_inserted_slot := _slot_key;
          EXCEPTION WHEN unique_violation THEN NULL;
          END;
        END LOOP;
        IF _inserted_slots <= 0 THEN UPDATE public.ships_owned SET at_sea = true, fishing_started_at = _new_last_at, last_fishing_reward_at = _new_last_at WHERE id = _ship_locked.id; EXIT; END IF;

        SELECT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.user_id = _user AND inv.item_type = 'crew' AND inv.item_id = 'luck' AND inv.quantity > 0 AND inv.meta->>'assigned_ship_id' = _ship_locked.id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > _now)) INTO _has_luck;
        _luck_mult := CASE WHEN _has_luck THEN 2 ELSE 1 END;
        SELECT true, NULLIF(inv.meta->>'preferred_fish_id','') INTO _has_guide, _guide_pref FROM public.inventory inv WHERE inv.user_id = _user AND inv.item_type = 'crew' AND inv.item_id = 'guide' AND inv.meta->>'assigned_ship_id' = _ship_locked.id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > _now) LIMIT 1;
        _has_guide := COALESCE(_has_guide, false);
        _pool := COALESCE(_pool, '[]'::jsonb); _pool_len := jsonb_array_length(_pool);
        IF _pool_len <= 0 THEN UPDATE public.ships_owned SET at_sea = false, fishing_started_at = NULL, last_fishing_reward_at = NULL WHERE id = _ship_locked.id; EXIT; END IF;
        _ship_preferred := NULL;
        IF _has_guide AND _guide_pref IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _guide_pref) THEN _ship_preferred := _guide_pref;
        ELSIF NULLIF(_ship_locked.preferred_fish_id, '') IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _ship_locked.preferred_fish_id) THEN _ship_preferred := _ship_locked.preferred_fish_id; END IF;
        IF _ship_preferred IS NOT NULL THEN _chosen := _ship_preferred; ELSE SELECT p.value INTO _chosen FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord) WHERE p.ord = (1 + (abs(hashtextextended(_ship_locked.id::text || ':' || _last_at::text, 71003)) % _pool_len)) LIMIT 1; END IF;
        IF _has_guide AND _guide_pref IS NOT NULL AND _ship_locked.preferred_fish_id IS DISTINCT FROM _guide_pref THEN UPDATE public.ships_owned SET preferred_fish_id = _guide_pref WHERE id = _ship_locked.id; END IF;

        _capacity := GREATEST(1, CASE WHEN COALESCE(_ship_locked.catalog_code,'') IN ('submarine','upgrade-sub') OR COALESCE(_ship_locked.template_id,0) IN (32,33) THEN COALESCE(_ship_locked.max_hp, _capacity, _qty, 1)::bigint ELSE COALESCE(_capacity, _qty, 1)::bigint END);
        _capacity := GREATEST(1, FLOOR(_capacity * _hp_ratio)::bigint);
        _qty := LEAST(_capacity * _luck_mult::bigint, GREATEST(0, _market_remaining));
        IF _qty < 1 THEN UPDATE public.ships_owned SET at_sea = true WHERE id = _ship_locked.id; _market_full := true; EXIT; END IF;
        SELECT COALESCE(current_price, 0)::bigint INTO _unit_value FROM public.fish_market_prices WHERE fish_id = _chosen LIMIT 1;
        UPDATE public.ships_owned SET at_sea = true, fishing_started_at = _new_last_at, last_fishing_reward_at = _new_last_at WHERE id = _ship_locked.id;
        INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught) VALUES (_user, _chosen, _qty::int, _qty::int)
        ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE SET quantity = public.fish_caught.quantity + EXCLUDED.quantity, total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught, updated_at = now();
        INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity) VALUES (_user, _chosen, _ship_locked.id, _now, COALESCE(_unit_value,0), _qty::int);
        IF _last_inserted_slot IS NOT NULL THEN UPDATE public.golden_fisher_rewards SET qty = _qty, fish_id = _chosen WHERE ship_id = _ship_locked.id AND reward_slot = _last_inserted_slot; END IF;
        _market_remaining := GREATEST(0, _market_remaining - _qty); _ships_processed := _ships_processed + 1; _ships_launched := _ships_launched + 1; _total_cycles := _total_cycles + _inserted_slots; _total_fish := _total_fish + _qty;
        IF _market_remaining <= 0 THEN _market_full := true; EXIT; END IF;
      EXCEPTION WHEN deadlock_detected OR lock_not_available THEN IF _attempt < 3 THEN _retry := true; PERFORM pg_sleep(0.05 * _attempt); END IF;
        WHEN OTHERS THEN INSERT INTO public.golden_fisher_errors(user_id, ship_id, cycles, fish_added, remaining_storage, exec_ms, error) VALUES (_user, _ship.id, _cycles, _qty, _market_remaining, EXTRACT(MILLISECONDS FROM (clock_timestamp() - _t_start))::int, SQLERRM);
      END;
    END LOOP;
    IF _market_full THEN EXIT; END IF;
  END LOOP;

  IF _market_full THEN
    UPDATE public.ships_owned SET at_sea = true, fishing_started_at = COALESCE(fishing_started_at, _now), last_fishing_reward_at = COALESCE(last_fishing_reward_at, fishing_started_at, _now)
     WHERE user_id = _user AND COALESCE(in_storage, false) = false AND stealing_target_user_id IS NULL AND stealing_ends_at IS NULL
       AND (COALESCE(max_hp, 0) <= 0 OR COALESCE(hp, max_hp, 1)::numeric / GREATEST(max_hp, 1)::numeric >= 0.30);
  END IF;
  RETURN jsonb_build_object('ok', true, 'ships_processed', _ships_processed, 'launched', _ships_launched, 'cycles', _total_cycles, 'fish_added', _total_fish, 'waiting_for_space', _market_full::int, 'market_full', _market_full);
END;
$$;