-- Fix special ship catalog rows so upgradeable submarine is independent from Phoenix.
UPDATE public.ship_catalog
SET
  market_level_required = 31,
  sort_order = 33,
  name = 'الغواصة القابلة للترقية',
  description = 'غواصة قابلة للترقية بنظام نجوم. تبدأ بسعة 350 ألف وتصل إلى 1 مليون. تصيد كراكن ولوياثان وبوسيدون فقط.',
  rarity = 'Legendary',
  max_hp = 350000,
  storage = 350000,
  fishing_seconds = 3000,
  fish_pool = '["kraken","leviathan","poseidon"]'::jsonb,
  price_coins = 15000000000,
  active = true
WHERE code = 'upgrade-sub';

UPDATE public.ship_catalog
SET
  market_level_required = 31,
  sort_order = 31,
  name = 'سفينة العنقاء التنينية',
  description = 'سفينة العنقاء الحمراء — حصرية للمتجر. تصيد عنقاء النار فقط.',
  rarity = 'Legendary',
  max_hp = 13000,
  storage = 13000,
  fishing_seconds = 1200,
  fish_pool = '["phoenix"]'::jsonb,
  price_coins = 0,
  active = true
WHERE code = 'phoenix';

UPDATE public.ship_catalog
SET
  market_level_required = 32,
  sort_order = 32,
  name = 'الغواصة الملكية VIP',
  description = 'غواصة VIP ملكية تصيد تيتان الأعماق فقط، وسعتها حسب مستوى VIP عند الاستلام.',
  rarity = 'Mythic',
  max_hp = 350000,
  storage = 350000,
  fishing_seconds = 2700,
  fish_pool = '["abyss_titan"]'::jsonb,
  price_coins = 0,
  active = true
WHERE code = 'submarine';

-- Regular ships: HP should match the described storage/capacity model.
UPDATE public.ship_catalog
SET max_hp = storage
WHERE code LIKE 'ship-lvl-%'
  AND sort_order BETWEEN 1 AND 30;

-- Repair previously bought upgradeable submarines that were stored as Phoenix level 31.
UPDATE public.ships_owned
SET
  template_id = 33,
  max_hp = public.submarine_capacity_for_stars(COALESCE(stars, 1)),
  hp = LEAST(GREATEST(COALESCE(hp, public.submarine_capacity_for_stars(COALESCE(stars, 1))), 1), public.submarine_capacity_for_stars(COALESCE(stars, 1)))
WHERE catalog_code = 'upgrade-sub';

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
  _put_in_storage boolean := false;
  _cur_coins bigint;
  _cur_gems integer;
  _coins_to_spend bigint;
  _gems_to_spend integer := 0;
  _shortfall bigint;
  _cat record;
  _required_level int;
  _stored_template int;
  _stored_hp int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _price_coins < 0 OR _price_coins > 100000000000 THEN RAISE EXCEPTION 'bad price'; END IF;
  IF _max_hp < 50 OR _max_hp > 1000000 THEN RAISE EXCEPTION 'bad hp'; END IF;
  IF _template_id < 1 OR _template_id > 100 THEN RAISE EXCEPTION 'bad template'; END IF;

  SELECT * INTO _cat
  FROM public.ship_catalog
  WHERE code = _code AND active = true
  LIMIT 1;

  _required_level := COALESCE(_cat.market_level_required, _template_id);
  _stored_template := COALESCE(_cat.sort_order, _template_id);
  _stored_hp := CASE
    WHEN _code = 'upgrade-sub' THEN public.submarine_capacity_for_stars(1)
    WHEN _code = 'submarine' THEN _max_hp
    ELSE _max_hp
  END;

  SELECT level INTO _market_level FROM public.user_market WHERE user_id = _uid;
  IF _market_level IS NULL THEN _market_level := 1; END IF;
  IF _required_level > _market_level THEN RAISE EXCEPTION 'market level too low'; END IF;

  SELECT
    COUNT(*) FILTER (WHERE NOT in_storage),
    COUNT(*) FILTER (WHERE in_storage)
  INTO _active_count, _storage_count
  FROM public.ships_owned WHERE user_id = _uid;

  IF _active_count >= 3 THEN
    IF _storage_count >= 3 THEN
      RAISE EXCEPTION 'fleet and storage full';
    END IF;
    _put_in_storage := true;
  END IF;

  SELECT coins, gems INTO _cur_coins, _cur_gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _cur_coins IS NULL THEN RAISE EXCEPTION 'no profile'; END IF;

  IF _cur_coins >= _price_coins THEN
    _coins_to_spend := _price_coins;
    _gems_to_spend := 0;
  ELSE
    _coins_to_spend := _cur_coins;
    _shortfall := _price_coins - _cur_coins;
    _gems_to_spend := CEIL(_shortfall::numeric / 1000.0)::int;
    IF _cur_gems < _gems_to_spend THEN
      RAISE EXCEPTION 'insufficient coins and gems';
    END IF;
  END IF;

  PERFORM public._mutate_currency(_uid, -_coins_to_spend, -_gems_to_spend, 0, 0);
  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp, in_storage, stars, max_stars)
    VALUES (_uid, _stored_template, _code, false, _stored_hp, _stored_hp, _put_in_storage, 1, CASE WHEN _code = 'upgrade-sub' THEN 1 ELSE 1 END)
    RETURNING id INTO _new;
  RETURN _new;
END
$function$;
GRANT EXECUTE ON FUNCTION public.buy_ship_by_code(text, integer, bigint, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.collect_fishing_reward(_ship_id uuid, _requested_fish_id text DEFAULT NULL::text)
 RETURNS TABLE(fish_id text, fish_qty integer, base_qty integer, luck_bonus integer, xp_awarded integer, elapsed_seconds integer, duration_seconds integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ship record; _cat record; _pool jsonb; _pool_len integer; _chosen text;
  _capacity integer;
  _market_remaining bigint;
  _duration integer; _elapsed numeric; _ratio numeric;
  _sailor_mult numeric := 1; _luck_mult integer := 1; _has_crew boolean := false;
  _base integer; _qty integer; _xp integer; _unit_value bigint;
  _hp_ratio numeric := 1;
  _still_repairing boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _ship FROM public.ships_owned so WHERE so.id = _ship_id FOR UPDATE;
  IF _ship.id IS NULL OR _ship.user_id <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;

  IF _ship.destroyed_at IS NOT NULL AND _ship.repair_ends_at IS NOT NULL AND _ship.repair_ends_at > now() THEN
    _hp_ratio := public._ship_repair_ratio(_ship.destroyed_at, _ship.repair_ends_at);
    IF _hp_ratio < 0.30 THEN
      UPDATE public.ships_owned so SET at_sea = false, fishing_started_at = NULL WHERE so.id = _ship_id;
      RAISE EXCEPTION 'ship_destroyed';
    END IF;
    _still_repairing := true;
  END IF;

  IF _ship.fishing_started_at IS NULL THEN RAISE EXCEPTION 'not_fishing'; END IF;
  IF NOT COALESCE(_ship.at_sea, false) THEN
    UPDATE public.ships_owned so SET at_sea = true WHERE so.id = _ship_id;
  END IF;

  IF _ship.catalog_code IS NOT NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog sc WHERE sc.code = _ship.catalog_code AND sc.active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog sc WHERE sc.code = ('ship-lvl-' || COALESCE(_ship.template_id, 1)) AND sc.active = true LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog sc WHERE sc.sort_order = COALESCE(_ship.template_id, 1) AND sc.active = true ORDER BY sc.market_level_required ASC LIMIT 1;
  END IF;
  IF _cat.id IS NULL THEN RAISE EXCEPTION 'ship_catalog_missing'; END IF;

  SELECT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'sailor' AND inv.meta->>'assigned_ship_id' = _ship_id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())) INTO _has_crew;
  IF _has_crew THEN _sailor_mult := 1.0 / 0.5; END IF;
  SELECT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'luck' AND inv.meta->>'assigned_ship_id' = _ship_id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())) INTO _has_crew;
  IF _has_crew THEN _luck_mult := 2; END IF;
  SELECT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'guide' AND inv.meta->>'assigned_ship_id' = _ship_id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())) INTO _has_crew;

  _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
  _pool_len := jsonb_array_length(_pool);
  IF _pool_len <= 0 THEN RAISE EXCEPTION 'empty_fish_pool'; END IF;

  IF _has_crew AND _requested_fish_id IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _requested_fish_id) THEN
    _chosen := _requested_fish_id;
  ELSE
    SELECT p.value INTO _chosen FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
    WHERE p.ord = (1 + (abs(hashtextextended(_ship_id::text || ':' || _ship.fishing_started_at::text, 71003)) % _pool_len)) LIMIT 1;
  END IF;

  _duration := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
  _capacity := GREATEST(1, CASE
    WHEN COALESCE(_ship.catalog_code, '') IN ('submarine', 'upgrade-sub') OR COALESCE(_ship.template_id, 0) IN (32, 33)
      THEN COALESCE(_ship.max_hp, _cat.storage, 10)
    ELSE COALESCE(_cat.storage, 10)
  END);
  _capacity := GREATEST(1, FLOOR(_capacity * _hp_ratio)::integer);

  _market_remaining := public.user_market_remaining(_uid);

  _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (now() - _ship.fishing_started_at)) * _sailor_mult);
  _ratio := LEAST(1, _elapsed / _duration);

  _base := FLOOR(_capacity * _ratio)::integer;
  IF _base <= 0 THEN
    _base := 1;
  END IF;
  _base := LEAST(_base, _capacity);

  _qty := _base * _luck_mult;
  IF _market_remaining > 0 THEN
    _qty := LEAST(_qty::bigint, _market_remaining)::int;
    IF _qty < 1 THEN _qty := 1; END IF;
  ELSE
    _qty := 0;
  END IF;

  _xp := 0;

  UPDATE public.ships_owned so SET at_sea = false, fishing_started_at = NULL, last_fishing_reward_at = now() WHERE so.id = _ship_id;

  IF _qty > 0 THEN
    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    VALUES (_uid, _chosen, _qty, _qty)
    ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE
    SET quantity = public.fish_caught.quantity + _qty,
        total_caught = public.fish_caught.total_caught + _qty,
        updated_at = now();

    SELECT COALESCE(current_price, 0)::bigint INTO _unit_value FROM public.fish_market_prices WHERE fish_market_prices.fish_id = _chosen;
    INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
    VALUES (_uid, _chosen, _ship_id, now(), _unit_value, _qty);

    INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty) VALUES (_uid, _chosen, now(), _qty);
  END IF;

  fish_id := _chosen; fish_qty := _qty; base_qty := _base;
  luck_bonus := GREATEST(0, _qty - _base); xp_awarded := _xp;
  elapsed_seconds := FLOOR(_elapsed)::integer; duration_seconds := _duration;
  RETURN NEXT;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.collect_fishing_reward(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collect_fishing_reward(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.golden_fisher_tick(_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ship record;
  _cat record;
  _pool jsonb;
  _pool_len int;
  _chosen text;
  _capacity int;
  _market_remaining bigint;
  _qty int;
  _unit_value bigint;
  _cycles int := 0;
  _ships_processed int := 0;
  _now timestamptz := now();
  _elapsed int;
  _duration int;
  _is_active boolean;
  _luck_mult int;
  _has_guide boolean;
  _preferred text;
BEGIN
  SELECT (
    (golden_fisher_until IS NOT NULL AND golden_fisher_until > _now)
    OR EXISTS (
      SELECT 1 FROM public.inventory i
      WHERE i.user_id = _user
        AND i.item_type = 'crew'
        AND i.item_id = 'golden_fisher'
        AND i.meta ? 'expires_at'
        AND (i.meta->>'expires_at')::timestamptz > _now
    )
  ) INTO _is_active
  FROM public.profiles WHERE id = _user;

  IF NOT COALESCE(_is_active, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  FOR _ship IN
    SELECT * FROM public.ships_owned
    WHERE user_id = _user
      AND in_storage = false
      AND destroyed_at IS NULL
      AND (repair_ends_at IS NULL OR repair_ends_at <= _now)
      AND stealing_target_user_id IS NULL
      AND stealing_ends_at IS NULL
    FOR UPDATE
  LOOP
    SELECT * INTO _cat
    FROM public.ship_catalog
    WHERE code = COALESCE(_ship.catalog_code, 'ship-lvl-' || COALESCE(_ship.template_id, 1))
      AND active = true
    LIMIT 1;

    IF _cat.id IS NULL THEN
      SELECT * INTO _cat
      FROM public.ship_catalog
      WHERE sort_order = COALESCE(_ship.template_id, 1)
        AND active = true
      ORDER BY market_level_required ASC
      LIMIT 1;
    END IF;

    IF _cat.id IS NULL THEN CONTINUE; END IF;

    _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
    _pool_len := jsonb_array_length(_pool);
    _duration := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
    IF _pool_len = 0 THEN CONTINUE; END IF;

    IF _ship.fishing_started_at IS NULL THEN
      UPDATE public.ships_owned
         SET fishing_started_at = _now,
             at_sea = true
       WHERE id = _ship.id;
      _ships_processed := _ships_processed + 1;
      CONTINUE;
    END IF;

    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (_now - _ship.fishing_started_at))::int);

    IF _elapsed < _duration THEN
      UPDATE public.ships_owned SET at_sea = true WHERE id = _ship.id;
      _ships_processed := _ships_processed + 1;
      CONTINUE;
    END IF;

    _capacity := GREATEST(1, CASE
      WHEN COALESCE(_ship.catalog_code, '') IN ('submarine', 'upgrade-sub') OR COALESCE(_ship.template_id, 0) IN (32, 33)
        THEN COALESCE(_ship.max_hp, _cat.storage, 10)
      ELSE COALESCE(_cat.storage, 10)
    END);

    _luck_mult := 1;
    IF EXISTS (
      SELECT 1 FROM public.inventory i
      WHERE i.user_id = _user
        AND i.item_type = 'crew'
        AND i.item_id = 'luck'
        AND (i.meta->>'assigned_ship_id') = _ship.id::text
        AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > _now)
    ) THEN
      _luck_mult := 2;
    END IF;

    _has_guide := false;
    _preferred := NULL;
    SELECT true, (i.meta->>'preferred_fish_id')
      INTO _has_guide, _preferred
    FROM public.inventory i
    WHERE i.user_id = _user
      AND i.item_type = 'crew'
      AND i.item_id = 'guide'
      AND (i.meta->>'assigned_ship_id') = _ship.id::text
      AND ((i.meta->>'expires_at') IS NULL OR (i.meta->>'expires_at')::timestamptz > _now)
    LIMIT 1;

    IF _has_guide AND _preferred IS NOT NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _preferred) THEN
      _chosen := _preferred;
    ELSE
      _chosen := _pool->>floor(random() * _pool_len)::int;
    END IF;

    _market_remaining := public.user_market_remaining(_user);

    IF _market_remaining > 0 THEN
      _qty := LEAST((_capacity * _luck_mult)::bigint, _market_remaining)::int;

      IF _qty > 0 THEN
        INSERT INTO public.fish_caught (user_id, fish_id, quantity, total_caught, updated_at)
        VALUES (_user, _chosen, _qty, _qty, _now)
        ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key DO UPDATE
          SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
              total_caught = public.fish_caught.total_caught + EXCLUDED.quantity,
              updated_at = _now;

        SELECT COALESCE(current_price, 0)::bigint INTO _unit_value
        FROM public.fish_market_prices
        WHERE fish_market_prices.fish_id = _chosen;

        INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
        VALUES (_user, _chosen, _ship.id, _now, COALESCE(_unit_value, 0), _qty);

        INSERT INTO public.competition_catches(user_id, fish_id, caught_at, qty)
        VALUES (_user, _chosen, _now, _qty);

        _cycles := _cycles + 1;
      END IF;
    END IF;

    UPDATE public.ships_owned
       SET fishing_started_at = _now,
           last_fishing_reward_at = _now,
           at_sea = true
     WHERE id = _ship.id;

    _ships_processed := _ships_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cycles', _cycles, 'ships', _ships_processed);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.golden_fisher_tick(uuid) TO service_role;