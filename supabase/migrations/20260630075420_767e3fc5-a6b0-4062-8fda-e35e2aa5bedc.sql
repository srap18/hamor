
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
  _destroyed_at timestamptz;
  _repair_ends_at timestamptz;
  _missing int;
  _hp_cost int;
  _time_cost int;
  _server_cost int;
  _remaining_secs numeric;
  _is_destroyed boolean;
  _cur_gems int;
  _inv_id uuid;
  _inv_qty int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT user_id, hp, max_hp, destroyed_at, repair_ends_at
    INTO _owner, _hp, _max, _destroyed_at, _repair_ends_at
    FROM public.ships_owned WHERE id = _ship_id FOR UPDATE;
  IF _owner IS NULL OR _owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;

  _is_destroyed := (_destroyed_at IS NOT NULL) OR (_repair_ends_at IS NOT NULL AND _repair_ends_at > now());

  _missing := GREATEST(0, COALESCE(_max,0) - COALESCE(_hp,0));
  _hp_cost := CASE WHEN _missing <= 0 THEN 0
                   ELSE GREATEST(5, CEIL(_missing::numeric / 100.0)::int) END;

  IF _repair_ends_at IS NOT NULL AND _repair_ends_at > now() THEN
    _remaining_secs := EXTRACT(EPOCH FROM (_repair_ends_at - now()));
    _time_cost := CEIL(_remaining_secs / 60.0)::int;
  ELSE
    _time_cost := 0;
  END IF;

  IF _is_destroyed THEN
    -- Destroyed ships cannot be instant-repaired with gems.
    -- Only a repair crew (fixer) item can restore them instantly, free of gem cost.
    _server_cost := 0;

    SELECT inv.id, inv.quantity INTO _inv_id, _inv_qty
    FROM public.inventory AS inv
    WHERE inv.user_id = _uid
      AND inv.item_type = 'crew'
      AND inv.item_id IN ('fixer_1','fixer_2','fixer_3','fixer_4')
      AND (inv.meta IS NULL OR inv.meta->>'assigned_ship_id' IS NULL)
    ORDER BY inv.acquired_at, inv.id
    LIMIT 1 FOR UPDATE;

    IF _inv_id IS NULL OR COALESCE(_inv_qty, 0) < 1 THEN
      RAISE EXCEPTION 'destroyed ship requires repair crew (no gems allowed)';
    END IF;
  ELSE
    _server_cost := GREATEST(_hp_cost, _time_cost);

    IF _missing > 0 OR _time_cost > 0 THEN
      SELECT inv.id, inv.quantity INTO _inv_id, _inv_qty
      FROM public.inventory AS inv
      WHERE inv.user_id = _uid
        AND inv.item_type = 'crew'
        AND inv.item_id IN ('fixer_1','fixer_2','fixer_3','fixer_4')
        AND (inv.meta IS NULL OR inv.meta->>'assigned_ship_id' IS NULL)
      ORDER BY inv.acquired_at, inv.id
      LIMIT 1 FOR UPDATE;

      IF _inv_id IS NULL OR COALESCE(_inv_qty, 0) < 1 THEN
        RAISE EXCEPTION 'no repair crew';
      END IF;
    END IF;

    IF _server_cost > 0 THEN
      SELECT gems INTO _cur_gems FROM public.profiles WHERE id = _uid FOR UPDATE;
      IF _cur_gems IS NULL OR _cur_gems < _server_cost THEN
        RAISE EXCEPTION 'insufficient gems';
      END IF;
      PERFORM public._mutate_currency(_uid, 0, -_server_cost, 0, 0);
    END IF;
  END IF;

  IF _inv_id IS NOT NULL THEN
    IF _inv_qty <= 1 THEN
      DELETE FROM public.inventory WHERE id = _inv_id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _inv_id;
    END IF;
  END IF;

  UPDATE public.ships_owned
     SET hp = max_hp,
         destroyed_at = NULL,
         repair_ends_at = NULL,
         at_sea = false,
         fishing_started_at = NULL
   WHERE id = _ship_id;
END $function$;
