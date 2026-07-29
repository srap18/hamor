CREATE OR REPLACE FUNCTION public._grant_ship_with_storage(_uid uuid, _catalog_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new uuid;
  _template int;
  _hp int;
  _active_count int;
  _storage_count int;
  _storage_cap int;
  _put_in_storage boolean := false;
BEGIN
  SELECT sort_order, max_hp INTO _template, _hp
    FROM public.ship_catalog WHERE code = _catalog_code LIMIT 1;
  IF _template IS NULL THEN RETURN NULL; END IF;

  SELECT
    COUNT(*) FILTER (WHERE NOT in_storage),
    COUNT(*) FILTER (WHERE in_storage)
  INTO _active_count, _storage_count
  FROM public.ships_owned WHERE user_id = _uid;

  SELECT GREATEST(3, LEAST(20, COALESCE(storage_capacity, 3)))
    INTO _storage_cap
    FROM public.profiles WHERE id = _uid;
  IF _storage_cap IS NULL THEN _storage_cap := 3; END IF;

  IF _active_count >= 3 THEN
    IF _storage_count >= _storage_cap THEN
      RETURN NULL;
    END IF;
    _put_in_storage := true;
  END IF;

  INSERT INTO public.ships_owned(user_id, template_id, catalog_code, at_sea, hp, max_hp, in_storage)
  VALUES (_uid, COALESCE(_template,1), _catalog_code, false, _hp, _hp, _put_in_storage)
  RETURNING id INTO _new;
  RETURN _new;
END $function$;