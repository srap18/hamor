CREATE OR REPLACE FUNCTION public.ship_market_required_fish_level(_target integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _target WHEN 11 THEN 10 WHEN 15 THEN 14 ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.market_start_upgrade()
 RETURNS TABLE(new_level integer, ends_at timestamp with time zone, cost_coins bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _cur record; _cost bigint; _secs int; _end timestamptz; _req int; _fish int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  PERFORM public.finalize_market_upgrades();
  SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL THEN
    INSERT INTO public.user_market(user_id, level) VALUES (_uid, 1) ON CONFLICT DO NOTHING;
    SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  END IF;
  IF _cur.upgrading_to IS NOT NULL THEN RAISE EXCEPTION 'already upgrading'; END IF;
  IF _cur.level >= 32 THEN RAISE EXCEPTION 'max level'; END IF;

  _req := public.ship_market_required_fish_level(_cur.level + 1);
  IF _req > 0 THEN
    PERFORM public.finalize_fish_market_upgrades();
    SELECT COALESCE(level, 1) INTO _fish FROM public.user_fish_market WHERE user_id = _uid;
    IF COALESCE(_fish, 1) < _req THEN
      RAISE EXCEPTION 'يجب أن يكون سوق السمك بمستوى % أو أعلى لترقية سوق السفن إلى المستوى %', _req, _cur.level + 1;
    END IF;
  END IF;

  SELECT muc.cost_coins, muc.seconds INTO _cost, _secs FROM public.market_upgrade_cost(_cur.level) AS muc;
  _end := now() + make_interval(secs => _secs);
  PERFORM public._mutate_currency(_uid, -_cost, 0, 0, 0);
  UPDATE public.user_market
    SET upgrading_to = _cur.level + 1,
        upgrade_started_at = now(),
        upgrade_ends_at = _end,
        upgrade_cost_coins = _cost,
        updated_at = now()
    WHERE user_id = _uid;
  RETURN QUERY SELECT (_cur.level + 1), _end, _cost;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ship_market_required_fish_level(integer) TO authenticated, anon, service_role;