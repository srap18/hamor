ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS armor_last_bought_at timestamptz;

REVOKE UPDATE (armor_last_bought_at) ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (armor_last_bought_at) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.buy_protection(_days int, _coins_cost bigint, _gems_cost int)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _new_until timestamptz;
  _last_bought timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _days < 1 OR _days > 30 THEN RAISE EXCEPTION 'bad days'; END IF;
  IF _coins_cost < 0 OR _gems_cost < 0 THEN RAISE EXCEPTION 'bad cost'; END IF;
  IF _coins_cost > 0 AND _coins_cost < _days * 1000 THEN RAISE EXCEPTION 'price too low'; END IF;
  IF _gems_cost > 0 AND _gems_cost < _days * 5 THEN RAISE EXCEPTION 'price too low'; END IF;

  SELECT armor_last_bought_at
    INTO _last_bought
  FROM public.profiles
  WHERE id = _uid
  FOR UPDATE;

  IF _last_bought IS NOT NULL AND _last_bought > now() - interval '7 days' THEN
    RAISE EXCEPTION 'armor_cooldown until %', (_last_bought + interval '7 days');
  END IF;

  PERFORM public._mutate_currency(_uid, -_coins_cost, -_gems_cost, 0, 0);

  SELECT GREATEST(now(), COALESCE(protection_until, now())) + make_interval(days => _days)
    INTO _new_until
  FROM public.profiles
  WHERE id = _uid;

  UPDATE public.profiles
     SET protection_until = _new_until,
         armor_last_bought_at = now()
   WHERE id = _uid;

  RETURN _new_until;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.buy_protection(int, bigint, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buy_protection(int, bigint, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_my_online_at()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  UPDATE public.profiles
     SET online_at = now()
   WHERE id = _uid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_my_online_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_online_at() TO authenticated;