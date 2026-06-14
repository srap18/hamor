
-- 1) Block attacks on ships that are currently at sea (fishing)
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer, _skip_fishing_check boolean DEFAULT false)
RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _owner uuid;
  _tpl int;
  _at_sea boolean;
  _repair_secs int;
  _resulting_hp int;
  _resulting_repair timestamptz;
  _prot timestamptz;
  _attacker uuid := auth.uid();
  _prev_hp int;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT s.user_id, s.template_id, COALESCE(s.hp, 100), COALESCE(s.at_sea, false)
    INTO _owner, _tpl, _prev_hp, _at_sea
    FROM public.ships_owned s
   WHERE s.id = _ship_id;

  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = _attacker THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  -- NEW: fishing ships are immune while at sea
  IF _at_sea THEN
    RAISE EXCEPTION 'ship_is_fishing';
  END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN
    RAISE EXCEPTION 'attacker market level under 6';
  END IF;

  IF NOT public.has_pvp_fleet(_attacker) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE user_id = _attacker AND in_storage = false AND destroyed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'attacker has destroyed ship';
  END IF;

  IF NOT public.has_fishing_ship(_attacker) THEN
    RAISE EXCEPTION 'attacker needs fishing ship: send a ship to fish first';
  END IF;

  IF NOT public.is_market_pvp_unlocked(_owner) THEN
    RAISE EXCEPTION 'target is protected (market level under 6)';
  END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _owner;
  IF _prot IS NOT NULL AND _prot > now() THEN
    RAISE EXCEPTION 'protected';
  END IF;

  _tpl := COALESCE(_tpl, 1);
  _repair_secs := LEAST(14400, GREATEST(60,
    ROUND(60 + (LEAST(30, GREATEST(1, _tpl)) - 1) * (14400 - 60) / 29.0)::int
  ));

  UPDATE public.ships_owned AS s
     SET hp = s.max_hp, destroyed_at = NULL, repair_ends_at = NULL
   WHERE s.id = _ship_id
     AND s.destroyed_at IS NOT NULL
     AND s.repair_ends_at IS NOT NULL
     AND s.repair_ends_at <= now();

  SELECT COALESCE(hp, 100) INTO _prev_hp FROM public.ships_owned WHERE id = _ship_id;

  UPDATE public.ships_owned AS s
     SET hp = GREATEST(0, COALESCE(s.hp, 100) - _damage),
         destroyed_at = CASE
           WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 AND s.destroyed_at IS NULL
           THEN now() ELSE s.destroyed_at END,
         repair_ends_at = CASE
           WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 AND s.destroyed_at IS NULL
           THEN now() + (_repair_secs || ' seconds')::interval
           ELSE s.repair_ends_at END
   WHERE s.id = _ship_id
   RETURNING s.hp, s.repair_ends_at INTO _resulting_hp, _resulting_repair;

  RETURN QUERY SELECT _resulting_hp, (_resulting_hp = 0), _resulting_repair;
END
$function$;

-- 2) Scale fishing capacity by current HP for partially-damaged (but alive) ships.
-- Existing under-repair logic (destroyed_at set) keeps using repair-progress ratio.
CREATE OR REPLACE FUNCTION public.collect_fishing_reward(_ship_id uuid, _requested_fish_id text DEFAULT NULL::text, _client_progress integer DEFAULT NULL::integer)
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
  _luck_mult integer := 1; _has_crew boolean := false;
  _has_guide boolean := false; _guide_pref text;
  _base integer; _qty integer; _xp integer; _unit_value bigint;
  _hp_ratio numeric := 1;
  _still_repairing boolean := false;
  _grace_seconds constant numeric := 5;
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
  ELSIF _ship.max_hp IS NOT NULL AND _ship.max_hp > 0 AND _ship.hp IS NOT NULL AND _ship.hp < _ship.max_hp THEN
    -- Partially damaged but alive: capacity scales linearly with HP.
    _hp_ratio := GREATEST(0.05, LEAST(1.0, _ship.hp::numeric / _ship.max_hp::numeric));
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

  SELECT EXISTS (SELECT 1 FROM public.inventory inv WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'luck' AND inv.meta->>'assigned_ship_id' = _ship_id::text AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())) INTO _has_crew;
  IF _has_crew THEN _luck_mult := 2; END IF;

  _has_guide := false; _guide_pref := NULL;
  SELECT true, NULLIF(inv.meta->>'preferred_fish_id','')
    INTO _has_guide, _guide_pref
  FROM public.inventory inv
  WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'guide'
    AND inv.meta->>'assigned_ship_id' = _ship_id::text
    AND ((inv.meta->>'expires_at') IS NULL OR (inv.meta->>'expires_at')::timestamptz > now())
  LIMIT 1;
  _has_guide := COALESCE(_has_guide, false);

  IF _ship.preferred_fish_id IS NOT NULL AND _ship.preferred_fish_id <> '' THEN
    _guide_pref := _ship.preferred_fish_id;
  END IF;

  _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
  _pool_len := jsonb_array_length(_pool);
  IF _pool_len <= 0 THEN RAISE EXCEPTION 'empty_fish_pool'; END IF;

  IF _has_guide AND _requested_fish_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _requested_fish_id) THEN
    _chosen := _requested_fish_id;
  ELSIF _has_guide AND _guide_pref IS NOT NULL
     AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _guide_pref) THEN
    _chosen := _guide_pref;
  ELSE
    SELECT p.value INTO _chosen FROM jsonb_array_elements_text(_pool) WITH ORDINALITY AS p(value, ord)
    WHERE p.ord = (1 + (abs(hashtextextended(_ship_id::text || ':' || _ship.fishing_started_at::text, 71003)) % _pool_len)) LIMIT 1;
  END IF;

  IF _has_guide AND _chosen IS NOT NULL
     AND (_ship.preferred_fish_id IS DISTINCT FROM _chosen) THEN
    UPDATE public.ships_owned SET preferred_fish_id = _chosen WHERE id = _ship_id;
    UPDATE public.inventory inv
       SET meta = COALESCE(inv.meta, '{}'::jsonb) || jsonb_build_object('preferred_fish_id', _chosen)
     WHERE inv.user_id = _uid AND inv.item_type = 'crew' AND inv.item_id = 'guide'
       AND inv.meta->>'assigned_ship_id' = _ship_id::text;
  END IF;

  _duration := GREATEST(1, COALESCE(_cat.fishing_seconds, 30));
  _capacity := GREATEST(1, CASE
    WHEN COALESCE(_ship.catalog_code, '') IN ('submarine', 'upgrade-sub') OR COALESCE(_ship.template_id, 0) IN (32, 33)
      THEN COALESCE(_ship.max_hp, _cat.storage, 10)
    ELSE COALESCE(_cat.storage, 10)
  END);
  _capacity := GREATEST(1, FLOOR(_capacity * _hp_ratio)::integer);

  _market_remaining := public.user_market_remaining(_uid);

  IF _market_remaining <= 0 THEN
    RAISE EXCEPTION 'market_full';
  END IF;

  _elapsed := public._effective_fishing_elapsed(_uid, _ship_id, _ship.fishing_started_at, now()) + _grace_seconds;
  _ratio := LEAST(1, _elapsed / _duration);

  _base := ROUND(_capacity * _ratio)::integer;
  IF _base <= 0 THEN _base := 1; END IF;
  _base := LEAST(_base, _capacity);

  IF _client_progress IS NOT NULL AND _client_progress >= 0 THEN
    _base := LEAST(_base, _client_progress);
    IF _base < 1 THEN _base := 1; END IF;
  END IF;

  _qty := _base * _luck_mult;
  _qty := LEAST(_qty::bigint, _market_remaining)::int;
  IF _qty < 1 THEN _qty := 1; END IF;

  _xp := 0;

  UPDATE public.ships_owned so
     SET at_sea = false,
         fishing_started_at = NULL,
         last_fishing_reward_at = now()
   WHERE so.id = _ship_id;

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
