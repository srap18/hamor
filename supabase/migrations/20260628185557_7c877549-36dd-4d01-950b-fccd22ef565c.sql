CREATE OR REPLACE FUNCTION public.dragon_defense_bonus(_user_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT LEAST(40, GREATEST(0, FLOOR(public.dragon_overall_level(_user_id) * 40.0 / 150.0)::int));
$$;

GRANT EXECUTE ON FUNCTION public.dragon_defense_bonus(uuid) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public._try_anti_block(_defender uuid, _anti_id text, _pct int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _qty int;
  _roll int;
  _bonus int;
  _effective int;
BEGIN
  IF _defender IS NULL OR _anti_id IS NULL THEN RETURN false; END IF;
  SELECT quantity INTO _qty FROM public.inventory
    WHERE user_id = _defender AND item_type = 'anti' AND item_id = _anti_id
    FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RETURN false; END IF;

  _bonus := public.dragon_defense_bonus(_defender);
  _effective := LEAST(100, GREATEST(0, _pct + _bonus));

  _roll := (floor(random() * 100))::int + 1; -- 1..100
  IF _roll > _effective THEN RETURN false; END IF;

  IF _qty = 1 THEN
    DELETE FROM public.inventory
      WHERE user_id = _defender AND item_type = 'anti' AND item_id = _anti_id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
      WHERE user_id = _defender AND item_type = 'anti' AND item_id = _anti_id;
  END IF;
  RETURN true;
END;
$$;