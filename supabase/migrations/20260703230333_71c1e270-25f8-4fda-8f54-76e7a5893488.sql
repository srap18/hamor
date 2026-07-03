
CREATE OR REPLACE FUNCTION public.activate_market_expert()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _current timestamptz;
  _new_until timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM public._require_market_level(10);

  SELECT market_expert_until INTO _current FROM public.profiles WHERE id = _uid FOR UPDATE;

  -- Block re-activation while still active; user must wait for it to expire.
  IF _current IS NOT NULL AND _current > now() THEN
    RAISE EXCEPTION 'market_expert_already_active';
  END IF;

  SELECT * INTO _row
    FROM public.inventory
   WHERE user_id = _uid AND item_type = 'crew' AND item_id = 'market_expert'
     AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL) AND quantity > 0
   ORDER BY acquired_at ASC FOR UPDATE LIMIT 1;

  IF _row.id IS NULL THEN RAISE EXCEPTION 'no_market_expert_in_inventory'; END IF;

  IF _row.quantity <= 1 THEN DELETE FROM public.inventory WHERE id = _row.id;
  ELSE UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id; END IF;

  -- Always exactly 3 hours from now; no stacking.
  _new_until := now() + interval '3 hours';
  UPDATE public.profiles SET market_expert_until = _new_until WHERE id = _uid;
  RETURN jsonb_build_object('ok', true, 'until', _new_until);
END;
$function$;

-- Cap any currently-inflated timers back to 3 hours from now.
UPDATE public.profiles
   SET market_expert_until = now() + interval '3 hours'
 WHERE market_expert_until IS NOT NULL
   AND market_expert_until > now() + interval '3 hours';
