
CREATE OR REPLACE FUNCTION public.buy_offer(_offer_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _coins_cost bigint := 0;
  _gems_cost integer := 0;
  _items jsonb;
  _item jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Hardcoded offer catalog. Keep in sync with src/lib/offers.ts on the client.
  CASE _offer_id
    WHEN 'offer_nuke_3'       THEN _gems_cost := 270;   _items := '[{"id":"nuke","type":"weapon","qty":3}]'::jsonb;
    WHEN 'offer_nuke_6'       THEN _gems_cost := 510;   _items := '[{"id":"nuke","type":"weapon","qty":6}]'::jsonb;
    WHEN 'offer_nuke_12'      THEN _gems_cost := 960;   _items := '[{"id":"nuke","type":"weapon","qty":12}]'::jsonb;
    WHEN 'offer_adbomb_5'     THEN _gems_cost := 765;   _items := '[{"id":"ad_bomb","type":"weapon","qty":5}]'::jsonb;
    WHEN 'offer_mix_warlord'  THEN _gems_cost := 880;   _items := '[{"id":"nuke","type":"weapon","qty":5},{"id":"ad_bomb","type":"weapon","qty":3}]'::jsonb;
    WHEN 'offer_mix_mega'     THEN _gems_cost := 1700;  _items := '[{"id":"nuke","type":"weapon","qty":10},{"id":"ad_bomb","type":"weapon","qty":5}]'::jsonb;
    WHEN 'offer_rocket_small_10'  THEN _coins_cost := 12000;  _items := '[{"id":"rocket_small","type":"weapon","qty":10}]'::jsonb;
    WHEN 'offer_rocket_medium_5'  THEN _coins_cost := 60000;  _items := '[{"id":"rocket_medium","type":"weapon","qty":5}]'::jsonb;
    WHEN 'offer_rocket_large_3'   THEN _coins_cost := 225000; _items := '[{"id":"rocket_large","type":"weapon","qty":3}]'::jsonb;
    WHEN 'offer_rocket_assorted'  THEN _coins_cost := 140000; _items := '[{"id":"rocket_small","type":"weapon","qty":20},{"id":"rocket_medium","type":"weapon","qty":5},{"id":"rocket_large","type":"weapon","qty":1}]'::jsonb;
    ELSE RAISE EXCEPTION 'unknown offer: %', _offer_id;
  END CASE;

  IF _coins_cost > 0 THEN
    PERFORM public._mutate_currency(_uid, -_coins_cost, 0, 0, 0);
  END IF;
  IF _gems_cost > 0 THEN
    PERFORM public._mutate_currency(_uid, 0, -_gems_cost, 0, 0);
  END IF;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items)
  LOOP
    INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid, _item->>'type', _item->>'id', (_item->>'qty')::integer, NULL)
    ON CONFLICT (user_id, item_type, item_id)
      WHERE meta IS NULL OR (meta->>'assigned_ship_id') IS NULL
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.buy_offer(text) TO authenticated;
