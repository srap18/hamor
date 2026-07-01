
CREATE OR REPLACE FUNCTION public.drop_my_protection()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _gf timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT golden_fisher_until INTO _gf FROM public.profiles WHERE id = auth.uid();

  UPDATE public.profiles
     SET protection_until = CASE
           WHEN _gf IS NOT NULL AND _gf > now() THEN _gf
           ELSE NULL
         END,
         shield_cooldown_until = now() + interval '2 minutes'
   WHERE id = auth.uid();
END;
$function$;

CREATE OR REPLACE FUNCTION public.quote_fish_sale_by_qty(_fish_id text, _qty integer)
RETURNS TABLE(sold integer, total_amount bigint, effective_unit_price numeric, current_price numeric, rot numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _current_price numeric := 0;
  _freeze_until timestamptz;
  _freeze_started_at timestamptz;
  _now timestamptz := now();
  _age_end timestamptz;
  _oldest_caught timestamptz;
  _hours numeric := 0;
  _available integer := 0;
  _max_override numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT COALESCE(NULLIF(fmp.current_price, 0), 1)
    INTO _current_price
    FROM public.fish_market_prices AS fmp
   WHERE fmp.fish_id = _fish_id;
  IF _current_price IS NULL OR _current_price <= 0 THEN _current_price := 1; END IF;

  IF _qty IS NULL OR _qty <= 0 THEN
    RETURN QUERY SELECT 0::integer, 0::bigint, 0::numeric, _current_price, 1::numeric;
    RETURN;
  END IF;

  SELECT ums.freeze_until, ums.freeze_started_at
    INTO _freeze_until, _freeze_started_at
    FROM public.user_market_state AS ums
   WHERE ums.user_id = _uid;

  IF _freeze_until IS NOT NULL AND _freeze_until > _now AND _freeze_started_at IS NOT NULL THEN
    _age_end := _freeze_started_at;
  ELSE
    _age_end := _now;
  END IF;

  SELECT MIN(fs.caught_at), COALESCE(SUM(fs.quantity), 0)::integer
    INTO _oldest_caught, _available
    FROM public.fish_stock AS fs
   WHERE fs.user_id = _uid AND fs.fish_id = _fish_id AND fs.quantity > 0;

  IF _oldest_caught IS NULL OR _available <= 0 THEN
    RETURN QUERY SELECT 0::integer, 0::bigint, 0::numeric, _current_price, 1::numeric;
    RETURN;
  END IF;

  _hours := GREATEST(0, EXTRACT(EPOCH FROM (GREATEST(_age_end, _oldest_caught) - _oldest_caught)) / 3600.0);
  rot := GREATEST(0.5, 1 - 0.01 * _hours);

  _max_override := public._market_expert_max_price(_uid, _fish_id);
  IF _max_override IS NOT NULL THEN
    effective_unit_price := GREATEST(0.0001, _max_override * rot);
  ELSE
    effective_unit_price := GREATEST(0.0001, _current_price * rot);
  END IF;

  sold := LEAST(_qty, _available);
  total_amount := GREATEST(0, ROUND(effective_unit_price * sold))::bigint;
  current_price := _current_price;

  RETURN NEXT;
END;
$function$;

-- Compensate players who reached day 15
DO $$
DECLARE
  _u record;
  _existing int;
BEGIN
  FOR _u IN
    SELECT user_id FROM public.daily_login_streaks WHERE current_streak >= 15
  LOOP
    SELECT quantity INTO _existing
      FROM public.inventory
     WHERE user_id = _u.user_id AND item_type = 'weapon' AND item_id = 'nuke'
     FOR UPDATE;
    IF _existing IS NULL THEN
      INSERT INTO public.inventory(user_id, item_type, item_id, quantity)
        VALUES (_u.user_id, 'weapon', 'nuke', 10);
    ELSE
      UPDATE public.inventory
         SET quantity = quantity + 10
       WHERE user_id = _u.user_id AND item_type = 'weapon' AND item_id = 'nuke';
    END IF;
  END LOOP;
END $$;
