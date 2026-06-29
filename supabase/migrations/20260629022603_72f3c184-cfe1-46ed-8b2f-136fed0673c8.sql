CREATE OR REPLACE FUNCTION public.buy_protection(_days integer, _coins_cost bigint, _gems_cost integer)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _new_until timestamptz;
  _last_bought timestamptz;
  _cur_gems int;
  _server_gems int;
  _interval interval;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Map client cost → authoritative price + duration.
  -- Tiers: 4h=60 gems, 1d=280 gems, 2d=550 gems.
  IF _gems_cost = 60 THEN
    _server_gems := 60;
    _interval := interval '4 hours';
  ELSIF _gems_cost = 280 THEN
    _server_gems := 280;
    _interval := interval '1 day';
  ELSIF _gems_cost = 550 THEN
    _server_gems := 550;
    _interval := interval '2 days';
  ELSE
    RAISE EXCEPTION 'invalid shield tier';
  END IF;

  SELECT armor_last_bought_at, gems INTO _last_bought, _cur_gems
    FROM public.profiles WHERE id = _uid FOR UPDATE;

  IF _last_bought IS NOT NULL AND _last_bought > now() - interval '4 days' THEN
    RAISE EXCEPTION 'armor_cooldown until %', (_last_bought + interval '4 days');
  END IF;

  IF _cur_gems IS NULL OR _cur_gems < _server_gems THEN
    RAISE EXCEPTION 'insufficient gems';
  END IF;

  PERFORM public._mutate_currency(_uid, 0, -_server_gems, 0, 0);

  SELECT GREATEST(now(), COALESCE(protection_until, now())) + _interval
    INTO _new_until
  FROM public.profiles WHERE id = _uid;

  UPDATE public.profiles
     SET protection_until = _new_until,
         armor_last_bought_at = now()
   WHERE id = _uid;

  RETURN _new_until;
END;
$function$;