
-- 1) Update starter ship trigger function to tag with catalog_code
CREATE OR REPLACE FUNCTION public.handle_new_user_starter_ship()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _hp int;
BEGIN
  SELECT max_hp INTO _hp FROM public.ship_catalog WHERE code = 'ship-lvl-1' AND active = true LIMIT 1;
  IF _hp IS NULL THEN _hp := 80; END IF;
  INSERT INTO public.ships_owned (user_id, template_id, catalog_code, at_sea, hp, max_hp)
  VALUES (NEW.id, 1, 'ship-lvl-1', false, _hp, _hp);
  RETURN NEW;
END;
$function$;

-- 2) Backfill: any existing starter without catalog_code -> tag as ship-lvl-1
UPDATE public.ships_owned
SET catalog_code = 'ship-lvl-1'
WHERE catalog_code IS NULL AND template_id = 1;

-- 3) Backfill: any user (in profiles) with zero ships gets a starter
INSERT INTO public.ships_owned (user_id, template_id, catalog_code, at_sea, hp, max_hp)
SELECT p.id, 1, 'ship-lvl-1', false, 80, 80
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.ships_owned s WHERE s.user_id = p.id);
