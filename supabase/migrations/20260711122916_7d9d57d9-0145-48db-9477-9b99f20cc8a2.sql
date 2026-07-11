CREATE OR REPLACE FUNCTION public.donate_to_tribe(_tribe_id uuid, _amount bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _coins bigint;
  _cap bigint := 10000;
  _tribe_cap bigint := 100000;
  _today_donated bigint;
  _tribe_today bigint;
  _day_start timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _amount < 100 THEN RAISE EXCEPTION 'min 100 coins'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tribe_members WHERE tribe_id = _tribe_id AND user_id = _uid) THEN
    RAISE EXCEPTION 'not a member';
  END IF;

  _day_start := date_trunc('day', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh';

  SELECT COALESCE(SUM(amount), 0) INTO _today_donated
    FROM public.tribe_donations
    WHERE user_id = _uid
      AND created_at >= _day_start;

  IF _today_donated + _amount > _cap THEN
    RAISE EXCEPTION 'daily cap exceeded: % / %', _today_donated, _cap;
  END IF;

  -- Tribe-wide daily cap (Asia/Riyadh)
  SELECT COALESCE(SUM(amount), 0) INTO _tribe_today
    FROM public.tribe_donations
    WHERE tribe_id = _tribe_id
      AND created_at >= _day_start;

  IF _tribe_today + _amount > _tribe_cap THEN
    RAISE EXCEPTION 'tribe daily cap exceeded: % / %', _tribe_today, _tribe_cap;
  END IF;

  SELECT coins INTO _coins FROM public.profiles WHERE id = _uid FOR UPDATE;
  IF _coins IS NULL OR _coins < _amount THEN RAISE EXCEPTION 'insufficient coins'; END IF;

  UPDATE public.profiles SET coins = coins - _amount WHERE id = _uid;
  UPDATE public.tribes
    SET treasure_coins = treasure_coins + _amount,
        total_donations = total_donations + _amount
    WHERE id = _tribe_id;

  UPDATE public.tribe_members
    SET donation_coins = donation_coins + _amount,
        last_donation_at = now()
    WHERE tribe_id = _tribe_id AND user_id = _uid;

  INSERT INTO public.tribe_donations(tribe_id, user_id, amount)
    VALUES (_tribe_id, _uid, _amount);

  RETURN json_build_object(
    'ok', true,
    'donated', _amount,
    'today_total', _today_donated + _amount,
    'cap', _cap,
    'tribe_today_total', _tribe_today + _amount,
    'tribe_cap', _tribe_cap
  );
END;
$function$;