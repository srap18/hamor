
CREATE OR REPLACE FUNCTION public.use_crew_from_inventory(_inventory_id uuid, _ship_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.inventory%ROWTYPE;
  _ship_owner uuid;
  _crew_id text;
  _expires timestamptz := now() + interval '24 hours';
  _trader_ends timestamptz;
  _snap jsonb;
  _anchor timestamptz;
  _new_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO _row FROM public.inventory WHERE id = _inventory_id FOR UPDATE;

  IF _row.id IS NULL OR _row.user_id <> _uid OR _row.item_type <> 'crew' OR _row.quantity < 1 THEN
    RAISE EXCEPTION 'no such crew';
  END IF;

  IF _row.meta IS NOT NULL AND _row.meta->>'assigned_ship_id' IS NOT NULL THEN
    RAISE EXCEPTION 'crew already used';
  END IF;

  _crew_id := _row.item_id;

  IF _crew_id = 'trader' THEN
    IF _row.quantity = 1 THEN
      DELETE FROM public.inventory WHERE id = _row.id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    END IF;

    _trader_ends := now() + interval '10 hours';
    _snap := public.build_trader_snapshot();
    _anchor := public.trader_snapshot_anchor();

    INSERT INTO public.user_market_state(user_id, trader_until, trader_snapshot, trader_anchor)
      VALUES (_uid, _trader_ends, _snap, _anchor)
    ON CONFLICT (user_id) DO UPDATE
      SET trader_until = GREATEST(COALESCE(public.user_market_state.trader_until, now()), EXCLUDED.trader_until),
          trader_snapshot = EXCLUDED.trader_snapshot,
          trader_anchor = EXCLUDED.trader_anchor,
          updated_at = now();

    RETURN jsonb_build_object('ok', true, 'kind', 'trader', 'until', _trader_ends);
  END IF;

  IF _ship_id IS NULL THEN
    RAISE EXCEPTION 'missing ship';
  END IF;

  SELECT user_id INTO _ship_owner FROM public.ships_owned WHERE id = _ship_id;

  IF _ship_owner IS NULL OR _ship_owner <> _uid THEN
    RAISE EXCEPTION 'ship not found';
  END IF;

  IF _crew_id = 'fixer_4' THEN
    UPDATE public.ships_owned
       SET hp = max_hp, destroyed_at = NULL, repair_ends_at = NULL
     WHERE user_id = _uid
       AND destroyed_at IS NULL;

    IF _row.quantity = 1 THEN
      DELETE FROM public.inventory WHERE id = _row.id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'kind', 'repair_all');
  END IF;

  UPDATE public.inventory
     SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('assigned_ship_id', _ship_id::text, 'assigned_until', _expires)
   WHERE id = _row.id;

  RETURN jsonb_build_object('ok', true, 'kind', 'assigned', 'ship_id', _ship_id, 'until', _expires);
END;
$function$;
