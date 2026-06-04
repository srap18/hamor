CREATE OR REPLACE FUNCTION public.collect_fishing_reward(_ship_db_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  _sailor_mult numeric := 1.0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventory_items
    WHERE user_id = auth.uid()
      AND item_type = 'crew'
      AND item_id = 'sailor'
      AND (meta->>'assigned_ship_id') IS NOT NULL
      AND (
        (meta->>'assigned_ship_id') = _ship_db_id::text
      )
  ) THEN
    _sailor_mult := 1.4;
  END IF;
  RETURN jsonb_build_object('sailor_mult', _sailor_mult);
END;
$func$;