
ALTER TABLE public.ships_owned ADD COLUMN IF NOT EXISTS fishing_started_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_ship_at_sea(_ship_id uuid, _at_sea boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT user_id INTO _owner FROM public.ships_owned WHERE id = _ship_id;
  IF _owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;
  UPDATE public.ships_owned
    SET at_sea = _at_sea,
        fishing_started_at = CASE
          WHEN _at_sea AND fishing_started_at IS NULL THEN now()
          WHEN NOT _at_sea THEN NULL
          ELSE fishing_started_at
        END
  WHERE id = _ship_id;
END $function$;
