CREATE OR REPLACE FUNCTION public.market_upgrade_cost(_level integer)
 RETURNS TABLE(cost_coins bigint, seconds integer)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    ((CASE _level
      WHEN 1  THEN 400::BIGINT
      WHEN 2  THEN 2500::BIGINT
      WHEN 3  THEN 7500::BIGINT
      WHEN 4  THEN 11000::BIGINT
      WHEN 5  THEN 20000::BIGINT
      WHEN 6  THEN 50000::BIGINT
      WHEN 7  THEN 90000::BIGINT
      WHEN 8  THEN 150000::BIGINT
      WHEN 9  THEN 300000::BIGINT
      WHEN 10 THEN 700000::BIGINT
      WHEN 11 THEN 2200000::BIGINT
      WHEN 12 THEN 5000000::BIGINT
      WHEN 13 THEN 8000000::BIGINT
      WHEN 14 THEN 12000000::BIGINT
      WHEN 15 THEN 18000000::BIGINT
      WHEN 16 THEN 25000000::BIGINT
      WHEN 17 THEN 34000000::BIGINT
      WHEN 18 THEN 45000000::BIGINT
      WHEN 19 THEN 60000000::BIGINT
      WHEN 20 THEN 80000000::BIGINT
      WHEN 21 THEN 110000000::BIGINT
      WHEN 22 THEN 150000000::BIGINT
      WHEN 23 THEN 200000000::BIGINT
      WHEN 24 THEN 300000000::BIGINT
      WHEN 25 THEN 650000000::BIGINT
      WHEN 26 THEN 800000000::BIGINT
      WHEN 27 THEN 1000000000::BIGINT
      WHEN 28 THEN 3640000000::BIGINT
      WHEN 29 THEN 9100000000::BIGINT
      WHEN 30 THEN 16380000000::BIGINT
      WHEN 31 THEN 500000000000::BIGINT
      ELSE 16380000000::BIGINT
    END) * 3 / 2)::BIGINT,
    CASE WHEN _level <= 2 THEN 30 WHEN _level <= 4 THEN 120 WHEN _level <= 7 THEN 900
         WHEN _level <= 10 THEN 3600 WHEN _level <= 15 THEN 14400 WHEN _level <= 20 THEN 43200
         WHEN _level <= 25 THEN 86400 ELSE 259200 END;
$function$;

CREATE OR REPLACE FUNCTION public.market_start_upgrade()
RETURNS TABLE(new_level int, ends_at timestamptz, cost_coins bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _uid uuid := auth.uid(); _cur record; _cost bigint; _secs int; _end timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  PERFORM public.finalize_market_upgrades();
  SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL THEN
    INSERT INTO public.user_market(user_id, level) VALUES (_uid, 1) ON CONFLICT DO NOTHING;
    SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  END IF;
  IF _cur.upgrading_to IS NOT NULL THEN RAISE EXCEPTION 'already upgrading'; END IF;
  IF _cur.level >= 32 THEN RAISE EXCEPTION 'max level'; END IF;
  SELECT muc.cost_coins, muc.seconds INTO _cost, _secs FROM public.market_upgrade_cost(_cur.level) AS muc;
  _end := now() + make_interval(secs => _secs);
  PERFORM public._mutate_currency(_uid, -_cost, 0, 0, 0);
  UPDATE public.user_market
    SET upgrading_to = _cur.level + 1,
        upgrade_started_at = now(),
        upgrade_ends_at = _end,
        upgrade_cost_coins = _cost,
        updated_at = now()
    WHERE user_id = _uid;
  RETURN QUERY SELECT (_cur.level + 1), _end, _cost;
END;
$$;

INSERT INTO public.ship_catalog (
  code, name, description, market_level_required, rarity, max_hp, armor, speed, storage,
  fishing_power, attack_power, fish_pool, price_coins, price_gems, repair_seconds, fishing_seconds,
  image_url, active, sort_order
) VALUES (
  'royal-whale',
  'الحوت الأرجواني',
  'غواصة-حوت أرجوانية ملكية قابلة للترقية بنظام النجوم. تبدأ بسعة 400 ألف وتصل إلى 3 مليون عند النجمة الحمراء.',
  32,
  'Mythic',
  400000,
  145,
  88,
  400000,
  400000,
  145,
  '["silver_arowana","coral_phantom"]'::jsonb,
  1000000000000,
  0,
  14400,
  3000,
  '/__l5e/assets-v1/whale-star-1/whale-star-1.png',
  true,
  37
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  market_level_required = EXCLUDED.market_level_required,
  rarity = EXCLUDED.rarity,
  max_hp = EXCLUDED.max_hp,
  armor = EXCLUDED.armor,
  speed = EXCLUDED.speed,
  storage = EXCLUDED.storage,
  fishing_power = EXCLUDED.fishing_power,
  attack_power = EXCLUDED.attack_power,
  fish_pool = EXCLUDED.fish_pool,
  price_coins = EXCLUDED.price_coins,
  price_gems = EXCLUDED.price_gems,
  repair_seconds = EXCLUDED.repair_seconds,
  fishing_seconds = EXCLUDED.fishing_seconds,
  image_url = EXCLUDED.image_url,
  active = EXCLUDED.active,
  sort_order = EXCLUDED.sort_order;

CREATE OR REPLACE FUNCTION public.upgrade_royal_whale(_ship_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ship record;
  _cost bigint := 50000000000;
  _stars int;
  _success_pct int;
  _roll int;
  _success boolean;
  _new_stars int;
  _new_cap int;
  _old_cap int;
  _new_hp int;
  _gold bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO _ship
  FROM public.ships_owned
  WHERE id = _ship_id AND user_id = _uid
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'ship_not_found'; END IF;
  IF _ship.catalog_code <> 'royal-whale' THEN RAISE EXCEPTION 'not_royal_whale'; END IF;
  IF _ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'destroyed'; END IF;

  _stars := COALESCE(_ship.stars, 1);
  IF _stars >= 5 THEN RAISE EXCEPTION 'already_max'; END IF;

  _success_pct := CASE _stars
    WHEN 1 THEN 60
    WHEN 2 THEN 50
    WHEN 3 THEN 40
    WHEN 4 THEN 25
    ELSE 0
  END;

  SELECT coins INTO _gold
  FROM public.profiles
  WHERE id = _uid
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
  IF COALESCE(_gold, 0) < _cost THEN RAISE EXCEPTION 'insufficient_gold'; END IF;

  PERFORM set_config('app.audit_source', 'upgrade_royal_whale', true);
  PERFORM set_config(
    'app.audit_reason',
    format('ترقية الحوت الأرجواني من %s نجمة بنسبة نجاح %s%%', _stars, _success_pct),
    true
  );

  UPDATE public.profiles
  SET coins = coins - _cost
  WHERE id = _uid;

  INSERT INTO public.economy_audit (
    user_id, coins_delta, coins_before, coins_after, source, reason, meta
  ) VALUES (
    _uid, -_cost, _gold, _gold - _cost, 'upgrade_royal_whale',
    'royal_whale_upgrade_cost',
    jsonb_build_object('ship_id', _ship_id, 'from_stars', _stars, 'success_pct', _success_pct)
  );

  _roll := floor(random() * 100)::int;
  _success := _roll < _success_pct;
  _new_stars := CASE
    WHEN _success THEN _stars + 1
    ELSE GREATEST(1, _stars - 1)
  END;

  _new_cap := CASE _new_stars
    WHEN 1 THEN 400000
    WHEN 2 THEN 900000
    WHEN 3 THEN 1500000
    WHEN 4 THEN 2200000
    WHEN 5 THEN 3000000
    ELSE 400000
  END;

  _old_cap := GREATEST(1, COALESCE(_ship.max_hp, CASE _stars
    WHEN 1 THEN 400000 WHEN 2 THEN 900000 WHEN 3 THEN 1500000
    WHEN 4 THEN 2200000 WHEN 5 THEN 3000000 ELSE 400000 END));

  _new_hp := LEAST(
    _new_cap,
    GREATEST(0, ROUND(COALESCE(_ship.hp, _old_cap)::numeric * _new_cap / _old_cap)::int)
  );

  UPDATE public.ships_owned
  SET stars = _new_stars,
      max_stars = GREATEST(COALESCE(max_stars, 1), _new_stars),
      max_hp = _new_cap,
      hp = _new_hp
  WHERE id = _ship_id;

  RETURN jsonb_build_object(
    'success', _success,
    'stars', _new_stars,
    'capacity', _new_cap,
    'hp', _new_hp,
    'roll', _roll,
    'success_pct', _success_pct
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.upgrade_royal_whale(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_royal_whale(uuid) TO service_role;