CREATE TABLE IF NOT EXISTS public.rocket_daily_purchases (
  user_id uuid NOT NULL,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  qty integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

GRANT SELECT ON public.rocket_daily_purchases TO authenticated;
GRANT ALL ON public.rocket_daily_purchases TO service_role;

ALTER TABLE public.rocket_daily_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own rocket quota read" ON public.rocket_daily_purchases
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public._consume_rocket_quota(_uid uuid, _item_id text, _count integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _used integer; _limit constant integer := 30; _day date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF _item_id NOT IN ('rocket_small','rocket_medium','rocket_large') THEN RETURN; END IF;
  INSERT INTO public.rocket_daily_purchases(user_id, day, qty)
    VALUES (_uid, _day, 0)
    ON CONFLICT (user_id, day) DO NOTHING;
  SELECT qty INTO _used FROM public.rocket_daily_purchases
    WHERE user_id = _uid AND day = _day FOR UPDATE;
  IF _used + _count > _limit THEN
    RAISE EXCEPTION 'rocket_daily_limit:%', GREATEST(_limit - _used, 0);
  END IF;
  UPDATE public.rocket_daily_purchases
    SET qty = qty + _count, updated_at = now()
    WHERE user_id = _uid AND day = _day;
END $$;

CREATE OR REPLACE FUNCTION public.buy_with_coins(_item_id text, _item_type text, _coins_cost bigint, _meta jsonb DEFAULT NULL::jsonb, _count integer DEFAULT 1)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price bigint; _total bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _count IS NULL OR _count < 1 OR _count > 999 THEN RAISE EXCEPTION 'bad count'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame','bubble_frame','profile_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;
  SELECT price_coins INTO _price FROM public.client_item_prices
    WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_coins INTO _price FROM public.items_catalog
      WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'item not buyable with coins: %', _item_id; END IF;
  IF _item_type IN ('frame','background','name_frame','bubble_frame','profile_frame') THEN _count := 1; END IF;
  PERFORM public._consume_rocket_quota(_uid, _item_id, _count);
  _total := CEIL(public.get_effective_shop_price(_uid, ((_price::bigint) * _count)::numeric))::bigint;
  PERFORM public._mutate_currency(_uid, -_total, 0, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, _count, _meta)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
  DO UPDATE
    SET quantity = public.inventory.quantity + EXCLUDED.quantity,
        meta = COALESCE(EXCLUDED.meta, public.inventory.meta);
END $function$;

CREATE OR REPLACE FUNCTION public.buy_with_coins(_item_id text, _item_type text, _coins_cost bigint, _meta jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;
  SELECT price_coins INTO _price FROM public.client_item_prices
    WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_coins INTO _price FROM public.items_catalog
      WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'item not buyable with coins: %', _item_id; END IF;
  PERFORM public._consume_rocket_quota(_uid, _item_id, 1);
  _price := CEIL(public.get_effective_shop_price(_uid, _price::numeric))::bigint;
  PERFORM public._mutate_currency(_uid, -_price, 0, 0, 0);
  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, 1, _meta)
    ON CONFLICT DO NOTHING;
END $function$;