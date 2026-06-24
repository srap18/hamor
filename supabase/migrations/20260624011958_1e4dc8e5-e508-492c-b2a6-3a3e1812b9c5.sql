
-- Guardian Dragon: defense bonus tied to dragon overall level (0..150).
-- Each 10 levels = +1% block chance, max +15%. Final block chance capped at 90%.

CREATE OR REPLACE FUNCTION public.dragon_overall_level(_user_id uuid)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _stage int;
  _dp bigint;
  _thresholds bigint[] := ARRAY[0,100,300,800,2000,5000,12000,25000,50000,100000,200000,400000,800000,1600000,3500000];
  _base bigint;
  _next bigint;
  _span bigint;
  _rel bigint;
  _sub int;
BEGIN
  SELECT stage, dp INTO _stage, _dp FROM public.dragons WHERE user_id = _user_id;
  IF _stage IS NULL THEN RETURN 0; END IF;
  _stage := GREATEST(1, LEAST(15, _stage));
  IF _stage = 1 AND COALESCE(_dp,0) <= 0 THEN RETURN 0; END IF;
  IF _stage >= 15 THEN RETURN 150; END IF;
  _base := _thresholds[_stage];
  _next := _thresholds[_stage + 1];
  _span := GREATEST(1, _next - _base);
  _rel := GREATEST(0, COALESCE(_dp,0) - _base);
  _sub := LEAST(10, FLOOR((_rel::numeric / _span::numeric) * 10)::int);
  RETURN (_stage - 1) * 10 + GREATEST(1, _sub + 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.dragon_overall_level(uuid) TO authenticated, anon;

-- Dragon defense bonus: floor(overall_level / 10), capped at 15.
-- Level 0 → 0%, Level 10 → +1%, Level 50 → +5%, Level 100 → +10%, Level 150 → +15%.
CREATE OR REPLACE FUNCTION public.dragon_defense_bonus(_user_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT LEAST(15, GREATEST(0, FLOOR(public.dragon_overall_level(_user_id) / 10.0)::int));
$$;

GRANT EXECUTE ON FUNCTION public.dragon_defense_bonus(uuid) TO authenticated, anon;

-- Replace _try_anti_block: add Guardian Dragon bonus, cap effective rate at 90%.
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
  _effective := LEAST(90, GREATEST(0, _pct + _bonus));

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
