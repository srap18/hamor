
-- 1) buy_protection: server-side gem pricing only
CREATE OR REPLACE FUNCTION public.buy_protection(_days integer, _coins_cost bigint, _gems_cost integer)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _new_until timestamptz;
  _last_bought timestamptz;
  _server_gems int;
  _cur_gems int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _days < 1 OR _days > 30 THEN RAISE EXCEPTION 'bad days'; END IF;

  -- Authoritative price: 280 gems per day (matches shop shield-1d rate)
  _server_gems := _days * 280;

  SELECT armor_last_bought_at, gems INTO _last_bought, _cur_gems
    FROM public.profiles WHERE id = _uid FOR UPDATE;

  IF _last_bought IS NOT NULL AND _last_bought > now() - interval '7 days' THEN
    RAISE EXCEPTION 'armor_cooldown until %', (_last_bought + interval '7 days');
  END IF;

  IF _cur_gems IS NULL OR _cur_gems < _server_gems THEN
    RAISE EXCEPTION 'insufficient gems';
  END IF;

  PERFORM public._mutate_currency(_uid, 0, -_server_gems, 0, 0);

  SELECT GREATEST(now(), COALESCE(protection_until, now())) + make_interval(days => _days)
    INTO _new_until
  FROM public.profiles WHERE id = _uid;

  UPDATE public.profiles
     SET protection_until = _new_until,
         armor_last_bought_at = now()
   WHERE id = _uid;

  RETURN _new_until;
END;
$function$;

-- 2) buy_shield_to_inventory: server-side gem pricing only
CREATE OR REPLACE FUNCTION public.buy_shield_to_inventory(_item_id text, _qty integer, _coins_cost bigint, _gems_cost integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _hours int;
  _unit_gems int;
  _total_gems int;
  _cur_gems int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty < 1 OR _qty > 50 THEN RAISE EXCEPTION 'bad qty'; END IF;

  _hours := CASE _item_id
    WHEN 'shield_1h' THEN 1
    WHEN 'shield_4h' THEN 4
    WHEN 'shield_1d' THEN 24
    WHEN 'shield_2d' THEN 48
    WHEN 'shield_7d' THEN 24*7
    WHEN 'shield_30d' THEN 24*30
    ELSE 0 END;
  IF _hours = 0 THEN RAISE EXCEPTION 'invalid_shield'; END IF;

  _unit_gems := CASE _item_id
    WHEN 'shield_1h' THEN 20
    WHEN 'shield_4h' THEN 60
    WHEN 'shield_1d' THEN 280
    WHEN 'shield_2d' THEN 550
    WHEN 'shield_7d' THEN 1500
    WHEN 'shield_30d' THEN 5000
    ELSE 0 END;
  _total_gems := _unit_gems * _qty;

  SELECT gems INTO _cur_gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _cur_gems IS NULL OR _cur_gems < _total_gems THEN
    RAISE EXCEPTION 'insufficient gems';
  END IF;

  PERFORM public._mutate_currency(_uid, 0, -_total_gems, 0, 0);

  INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
  VALUES (_uid, 'shield', _item_id, _qty)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;

  RETURN jsonb_build_object('ok', true, 'item_id', _item_id, 'qty', _qty, 'gems_spent', _total_gems);
END;
$function$;

-- 3) repair_ship_instant: server-computed gem cost from missing HP
CREATE OR REPLACE FUNCTION public.repair_ship_instant(_ship_id uuid, _gems_cost integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
  _hp int;
  _max int;
  _missing int;
  _server_cost int;
  _cur_gems int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT user_id, hp, max_hp INTO _owner, _hp, _max
    FROM public.ships_owned WHERE id = _ship_id FOR UPDATE;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;

  _missing := GREATEST(0, COALESCE(_max,0) - COALESCE(_hp,0));
  -- Authoritative cost: 1 gem per 100 missing HP, minimum 5 if any repair needed
  _server_cost := CASE WHEN _missing <= 0 THEN 0
                       ELSE GREATEST(5, CEIL(_missing::numeric / 100.0)::int) END;

  IF _server_cost > 0 THEN
    SELECT gems INTO _cur_gems FROM public.profiles WHERE id = _uid FOR UPDATE;
    IF _cur_gems IS NULL OR _cur_gems < _server_cost THEN
      RAISE EXCEPTION 'insufficient gems';
    END IF;
    PERFORM public._mutate_currency(_uid, 0, -_server_cost, 0, 0);
  END IF;

  UPDATE public.ships_owned
     SET hp = max_hp,
         destroyed_at = NULL,
         repair_ends_at = NULL,
         at_sea = false,
         fishing_started_at = NULL
   WHERE id = _ship_id;
END $function$;

-- 4) buy_background (coins): no backgrounds are sold for coins — close the hole
CREATE OR REPLACE FUNCTION public.buy_background(_bg_id text, _price bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'backgrounds are gem-only — use buy_background_gems';
END $function$;
