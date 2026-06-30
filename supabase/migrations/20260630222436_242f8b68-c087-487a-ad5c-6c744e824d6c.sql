
DROP FUNCTION IF EXISTS public.buy_disabler_to_inventory(text, integer);

CREATE OR REPLACE FUNCTION public.buy_disabler_to_inventory(_item_id text, _qty integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _user UUID := auth.uid();
  _price int;
  _total bigint;
  _cur_gems bigint;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _qty IS NULL OR _qty < 1 OR _qty > 50 THEN RAISE EXCEPTION 'bad_qty'; END IF;

  _price := CASE _item_id
    WHEN 'disabler_rocket'   THEN 100
    WHEN 'disabler_nuke'     THEN 300
    WHEN 'disabler_ad_bomb'  THEN 500
    ELSE NULL
  END;
  IF _price IS NULL THEN RAISE EXCEPTION 'unknown_disabler'; END IF;

  _total := _price::bigint * _qty::bigint;

  SELECT gems INTO _cur_gems FROM public.profiles WHERE id = _user FOR UPDATE;
  IF COALESCE(_cur_gems, 0) < _total THEN RAISE EXCEPTION 'insufficient gems'; END IF;

  PERFORM public._mutate_currency(_user, 0, (-_total)::int, 0, 0);

  INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
  VALUES (_user, 'disabler', _item_id, _qty)
  ON CONFLICT (user_id, item_type, item_id) WHERE (meta IS NULL OR (meta ->> 'assigned_ship_id') IS NULL)
  DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;

  RETURN jsonb_build_object('ok', true, 'item_id', _item_id, 'qty', _qty, 'gems_spent', _total);
END;
$$;

REVOKE ALL ON FUNCTION public.buy_disabler_to_inventory(text, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buy_disabler_to_inventory(text, integer) TO authenticated;
