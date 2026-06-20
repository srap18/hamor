CREATE OR REPLACE FUNCTION public.admin_set_market_levels(_player uuid, _ship_level integer, _fish_level integer)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ship int := GREATEST(1, LEAST(31, COALESCE(_ship_level, 1)));
  _fish int := GREATEST(1, LEAST(30, COALESCE(_fish_level, 1)));
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_ADMIN';
  END IF;

  INSERT INTO public.user_market(user_id, level)
    VALUES (_player, _ship)
    ON CONFLICT (user_id) DO UPDATE SET level = EXCLUDED.level;

  INSERT INTO public.user_fish_market(user_id, level)
    VALUES (_player, _fish)
    ON CONFLICT (user_id) DO UPDATE SET level = EXCLUDED.level;

  RETURN json_build_object('ship_level', _ship, 'fish_level', _fish);
END;
$function$;