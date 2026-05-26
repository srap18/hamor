
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage int)
RETURNS TABLE(new_hp int, destroyed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _new_hp int;
  _owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT user_id INTO _owner FROM public.ships_owned WHERE id = _ship_id;
  IF _owner IS NULL THEN
    RAISE EXCEPTION 'ship not found';
  END IF;
  IF _owner = auth.uid() THEN
    RAISE EXCEPTION 'cannot attack own ship';
  END IF;
  UPDATE public.ships_owned
    SET hp = GREATEST(0, COALESCE(hp,100) - _damage),
        destroyed_at = CASE WHEN GREATEST(0, COALESCE(hp,100) - _damage) = 0 THEN now() ELSE destroyed_at END
  WHERE id = _ship_id
  RETURNING hp INTO _new_hp;
  RETURN QUERY SELECT _new_hp, _new_hp = 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_ship_damage(uuid, int) TO authenticated;
