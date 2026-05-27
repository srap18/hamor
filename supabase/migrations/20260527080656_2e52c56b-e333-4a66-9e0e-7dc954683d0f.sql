
-- 1) Restore the 5-arg buy_with_gems signature (the client sends _gems_cost + _count)
--    and allow the new cosmetic item types (bubble_frame, profile_frame).
DROP FUNCTION IF EXISTS public.buy_with_gems(text, text, integer, jsonb);
DROP FUNCTION IF EXISTS public.buy_with_gems(text, text, integer, jsonb, integer);

CREATE OR REPLACE FUNCTION public.buy_with_gems(
  _item_id text,
  _item_type text,
  _gems_cost integer,
  _meta jsonb DEFAULT NULL::jsonb,
  _count integer DEFAULT 1
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _price integer;
  _total bigint;
  _single_types text[] := ARRAY['frame','background','name_frame','bubble_frame','profile_frame'];
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _count IS NULL OR _count < 1 OR _count > 999 THEN RAISE EXCEPTION 'bad count'; END IF;
  IF _item_type NOT IN ('frame','background','weapon','crew','consumable',
                        'name_frame','bubble_frame','profile_frame') THEN
    RAISE EXCEPTION 'invalid item type';
  END IF;

  SELECT price_gems INTO _price FROM public.client_item_prices
   WHERE item_id = _item_id AND item_type = _item_type;
  IF _price IS NULL THEN
    SELECT price_gems INTO _price FROM public.items_catalog
     WHERE code = _item_id AND active = true;
  END IF;
  IF _price IS NULL OR _price <= 0 THEN
    RAISE EXCEPTION 'item not buyable with gems: %', _item_id;
  END IF;

  IF _item_type = ANY(_single_types) THEN _count := 1; END IF;
  _total := (_price::bigint) * _count;

  PERFORM public._mutate_currency(_uid, 0, -_total::integer, 0, 0);

  INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item_type, _item_id, _count, _meta)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
  DO UPDATE
    SET quantity = public.inventory.quantity + EXCLUDED.quantity,
        meta = COALESCE(EXCLUDED.meta, public.inventory.meta);

  PERFORM public.daughter_apply_purchase_bonus(0, _total::int);
END $function$;

GRANT EXECUTE ON FUNCTION public.buy_with_gems(text, text, integer, jsonb, integer) TO authenticated;

-- 2) Seed prices for all 32 new zodiac frames
WITH zodiac(suffix, price) AS (
  VALUES ('aries',1000),('phoenix',5000),('virgo',8000),('leo',12000),
         ('taurus',18000),('gemini',25000),('scorpio',50000),('pisces',75000)
),
items(prefix, item_type) AS (
  VALUES ('af_','frame'),('nf_','name_frame'),
         ('bf_','bubble_frame'),('pf_','profile_frame')
)
INSERT INTO public.client_item_prices (item_id, item_type, price_gems, price_coins)
SELECT items.prefix || zodiac.suffix, items.item_type, zodiac.price, 0
FROM zodiac CROSS JOIN items
ON CONFLICT (item_id, item_type) DO UPDATE
  SET price_gems = EXCLUDED.price_gems;
