UPDATE public.client_item_prices SET price_gems = 10000 WHERE item_type='weapon' AND item_id='kraken_bomb';

CREATE OR REPLACE FUNCTION public.buy_anti_to_inventory(_item_id text, _qty integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _unit_gems int;
  _total_gems int;
  _cur_gems int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _qty < 1 OR _qty > 50 THEN RAISE EXCEPTION 'bad qty'; END IF;

  _unit_gems := CASE _item_id
    WHEN 'anti_rocket'   THEN 50
    WHEN 'anti_nuke'     THEN 120
    WHEN 'anti_ad_bomb'  THEN 210
    WHEN 'anti_kraken'   THEN 10000
    ELSE 0 END;
  IF _unit_gems = 0 THEN RAISE EXCEPTION 'invalid_anti'; END IF;

  _total_gems := _unit_gems * _qty;

  SELECT gems INTO _cur_gems FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _cur_gems IS NULL OR _cur_gems < _total_gems THEN
    RAISE EXCEPTION 'insufficient gems';
  END IF;

  PERFORM public._mutate_currency(_uid, 0, -_total_gems, 0, 0);

  INSERT INTO public.inventory (user_id, item_type, item_id, quantity)
  VALUES (_uid, 'anti', _item_id, _qty)
  ON CONFLICT (user_id, item_type, item_id)
    WHERE ((meta IS NULL) OR ((meta ->> 'assigned_ship_id'::text) IS NULL))
    DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;

  RETURN jsonb_build_object('ok', true, 'item_id', _item_id, 'qty', _qty, 'gems_spent', _total_gems);
END;
$function$;

CREATE OR REPLACE FUNCTION public.buy_disabler_to_inventory(_item_id text, _qty integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
    WHEN 'disabler_kraken'   THEN 10000
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
$function$;