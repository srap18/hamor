
-- 1) Allow background + name_frame in inventory item_type
ALTER TABLE public.inventory DROP CONSTRAINT IF EXISTS inventory_item_type_check;
ALTER TABLE public.inventory ADD CONSTRAINT inventory_item_type_check
  CHECK (item_type = ANY (ARRAY['crew','weapon','consumable','decoration','frame','background','name_frame']));

-- 2) Rewrite buy_with_coins to accept _count and actually increment quantity
CREATE OR REPLACE FUNCTION public.buy_with_coins(
  _item_id text, _item_type text, _coins_cost bigint, _meta jsonb DEFAULT NULL::jsonb, _count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price bigint; _total bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _count IS NULL OR _count < 1 OR _count > 999 THEN RAISE EXCEPTION 'bad count'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;

  SELECT price_coins INTO _price FROM public.client_item_prices
    WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_coins INTO _price FROM public.items_catalog
      WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'item not buyable with coins: %', _item_id; END IF;

  -- Cosmetic single-ownership items: ignore _count beyond 1
  IF _item_type IN ('frame','background','name_frame') THEN
    _count := 1;
  END IF;

  _total := _price * _count;
  PERFORM public._mutate_currency(_uid, -_total, 0, 0, 0);

  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, _count, _meta)
  ON CONFLICT (user_id, item_type, item_id) DO UPDATE
    SET quantity = public.inventory.quantity + EXCLUDED.quantity,
        meta = COALESCE(EXCLUDED.meta, public.inventory.meta);
END $function$;

-- 3) Same fix for buy_with_gems
CREATE OR REPLACE FUNCTION public.buy_with_gems(
  _item_id text, _item_type text, _gems_cost integer, _meta jsonb DEFAULT NULL::jsonb, _count integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _price integer; _total bigint;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _count IS NULL OR _count < 1 OR _count > 999 THEN RAISE EXCEPTION 'bad count'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable','name_frame') THEN
    RAISE EXCEPTION 'invalid item type'; END IF;

  SELECT price_gems INTO _price FROM public.client_item_prices
    WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_gems INTO _price FROM public.items_catalog
      WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN RAISE EXCEPTION 'item not buyable with gems: %', _item_id; END IF;

  IF _item_type IN ('frame','background','name_frame') THEN
    _count := 1;
  END IF;

  _total := (_price::bigint) * _count;
  PERFORM public._mutate_currency(_uid, 0, -_total::integer, 0, 0);

  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, _count, _meta)
  ON CONFLICT (user_id, item_type, item_id) DO UPDATE
    SET quantity = public.inventory.quantity + EXCLUDED.quantity,
        meta = COALESCE(EXCLUDED.meta, public.inventory.meta);
END $function$;

-- 4) Auto-finalize overdue market upgrades whenever someone reads user_market
CREATE OR REPLACE FUNCTION public._auto_finalize_market()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.upgrade_ends_at IS NOT NULL
     AND NEW.upgrade_ends_at <= now()
     AND NEW.upgrading_to IS NOT NULL THEN
    NEW.level := NEW.upgrading_to;
    NEW.upgrading_to := NULL;
    NEW.upgrade_started_at := NULL;
    NEW.upgrade_ends_at := NULL;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $function$;

-- Run finalize once now to fix any current overdue rows
SELECT public.finalize_market_upgrades();
