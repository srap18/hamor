-- Remove ambiguous 2-arg overload; only the 3-arg version (used by the client) remains.
DROP FUNCTION IF EXISTS public.collect_fishing_reward(uuid, text);

-- Harden set_guide_fish: verify guide ownership + pool membership so the picker
-- is 100% accurate on every ship regardless of state.
CREATE OR REPLACE FUNCTION public.set_guide_fish(_ship_db_id uuid, _fish_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
  _tpl int;
  _code text;
  _pool jsonb;
  _owns_guide boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT user_id, template_id, catalog_code
    INTO _owner, _tpl, _code
  FROM public.ships_owned
  WHERE id = _ship_db_id;

  IF _owner IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ship_not_found');
  END IF;
  IF _owner <> _uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_your_ship');
  END IF;

  -- Must own an active guide crew (per-ship assignment NOT required).
  SELECT EXISTS (
    SELECT 1 FROM public.inventory inv
    WHERE inv.user_id = _uid
      AND inv.item_type = 'crew'
      AND inv.item_id  = 'guide'
      AND inv.quantity > 0
      AND ((inv.meta->>'expires_at') IS NULL
           OR (inv.meta->>'expires_at')::timestamptz > now())
  ) INTO _owns_guide;
  IF NOT _owns_guide THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_guide_crew');
  END IF;

  -- Resolve fish pool for this ship.
  SELECT c.fish_pool INTO _pool
  FROM public.ship_catalog c
  WHERE c.active = true
    AND (c.code = _code OR c.code = 'ship-lvl-' || COALESCE(_tpl, 1))
  ORDER BY (c.code = _code) DESC
  LIMIT 1;

  IF _pool IS NULL OR jsonb_array_length(_pool) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_pool');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(_pool) v(fid) WHERE v.fid = _fish_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'fish_not_in_pool');
  END IF;

  UPDATE public.ships_owned
     SET preferred_fish_id = _fish_id
   WHERE id = _ship_db_id;

  UPDATE public.inventory
     SET meta = COALESCE(meta, '{}'::jsonb)
                || jsonb_build_object('preferred_fish_id', _fish_id)
   WHERE user_id = _uid
     AND item_type = 'crew'
     AND item_id  = 'guide'
     AND (meta->>'assigned_ship_id') = _ship_db_id::text;

  RETURN jsonb_build_object('ok', true, 'fish_id', _fish_id);
END
$function$;

GRANT EXECUTE ON FUNCTION public.set_guide_fish(uuid, text) TO authenticated;