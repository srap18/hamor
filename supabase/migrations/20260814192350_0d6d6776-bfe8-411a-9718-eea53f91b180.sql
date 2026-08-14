
CREATE OR REPLACE FUNCTION public._crew_return_to_pool(_ship_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _r record; _n integer := 0;
BEGIN
  DELETE FROM public.inventory
   WHERE item_type = 'crew'
     AND meta->>'assigned_ship_id' = _ship_id::text
     AND (meta->>'expires_at') IS NOT NULL
     AND (meta->>'expires_at')::timestamptz <= now();

  FOR _r IN
    SELECT id, user_id, item_id, quantity FROM public.inventory
     WHERE item_type = 'crew' AND meta->>'assigned_ship_id' = _ship_id::text
     FOR UPDATE
  LOOP
    DELETE FROM public.inventory WHERE id = _r.id;
    INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_r.user_id, 'crew', _r.item_id, GREATEST(1, _r.quantity), '{}'::jsonb)
    ON CONFLICT (user_id, item_type, item_id) WHERE (meta->>'assigned_ship_id') IS NULL
      DO UPDATE SET quantity = public.inventory.quantity + EXCLUDED.quantity;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public._free_crew_on_ship_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._crew_return_to_pool(OLD.id);
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS trg_free_crew_on_ship_delete ON public.ships_owned;
CREATE TRIGGER trg_free_crew_on_ship_delete
BEFORE DELETE ON public.ships_owned
FOR EACH ROW EXECUTE FUNCTION public._free_crew_on_ship_delete();

CREATE OR REPLACE FUNCTION public.crew_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _expired integer := 0; _freed integer := 0; _s record;
BEGIN
  DELETE FROM public.inventory
   WHERE item_type = 'crew'
     AND meta->>'assigned_ship_id' IS NOT NULL
     AND (meta->>'expires_at') IS NOT NULL
     AND (meta->>'expires_at')::timestamptz <= now();
  GET DIAGNOSTICS _expired = ROW_COUNT;

  FOR _s IN
    SELECT DISTINCT (i.meta->>'assigned_ship_id')::uuid AS ship_id
      FROM public.inventory i
     WHERE i.item_type = 'crew'
       AND i.meta->>'assigned_ship_id' IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.ships_owned s WHERE s.id::text = i.meta->>'assigned_ship_id')
  LOOP
    _freed := _freed + public._crew_return_to_pool(_s.ship_id);
  END LOOP;

  RETURN jsonb_build_object('expired_removed', _expired, 'orphan_freed', _freed);
END; $$;

REVOKE ALL ON FUNCTION public.crew_cleanup() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crew_cleanup() TO service_role;

SELECT public.crew_cleanup();
