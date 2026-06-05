CREATE OR REPLACE FUNCTION public.test_steal_cancel_counter_one_fish()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid;
  _defender uuid;
  _attacker_ship uuid := gen_random_uuid();
  _defender_ship uuid := gen_random_uuid();
  _before_attacker bigint;
  _before_defender bigint;
  _after_attacker bigint;
  _after_defender bigint;
  _old_attacker_level int;
  _old_defender_level int;
  _row record;
BEGIN
  SELECT p1.id, p2.id INTO _attacker, _defender
  FROM public.profiles p1
  JOIN public.profiles p2 ON p2.id <> p1.id
  ORDER BY p1.created_at NULLS LAST, p2.created_at NULLS LAST
  LIMIT 1;

  IF _attacker IS NULL OR _defender IS NULL THEN
    RAISE EXCEPTION 'need two existing users to verify steal';
  END IF;

  SELECT level INTO _old_attacker_level FROM public.user_fish_market WHERE user_id = _attacker;
  SELECT level INTO _old_defender_level FROM public.user_fish_market WHERE user_id = _defender;
  INSERT INTO public.user_fish_market(user_id, level) VALUES (_attacker, 30), (_defender, 30)
  ON CONFLICT (user_id) DO UPDATE SET level = EXCLUDED.level;

  PERFORM set_config('request.jwt.claim.sub', _attacker::text, true);

  INSERT INTO public.ships_owned(id, user_id, template_id, catalog_code, at_sea, fishing_started_at, stealing_target_user_id, stealing_target_ship_id, stealing_ends_at)
  VALUES
    (_attacker_ship, _attacker, 1, 'ship-lvl-1', true, now() - interval '1 second', _defender, _defender_ship, now() + interval '79 seconds'),
    (_defender_ship, _defender, 1, 'ship-lvl-1', true, now() - interval '5 minutes', NULL, NULL, NULL);
  INSERT INTO public.fish_stock(user_id, fish_id, ship_id, base_value, quantity)
  VALUES (_defender, 'sardine', _defender_ship, 999999, 25);

  SELECT COALESCE(SUM(quantity),0) INTO _before_attacker FROM public.fish_stock WHERE user_id = _attacker;
  SELECT COALESCE(SUM(quantity),0) INTO _before_defender FROM public.fish_stock WHERE user_id = _defender;
  SELECT * INTO _row FROM public.cancel_steal_mission(_attacker_ship);
  SELECT COALESCE(SUM(quantity),0) INTO _after_attacker FROM public.fish_stock WHERE user_id = _attacker;
  SELECT COALESCE(SUM(quantity),0) INTO _after_defender FROM public.fish_stock WHERE user_id = _defender;

  IF COALESCE(_row.stolen_count, 0) <> 1 OR _after_attacker <> _before_attacker + 1 OR _after_defender <> _before_defender - 1 THEN
    RAISE EXCEPTION 'counter-one cancel test failed: stolen %, attacker % -> %, defender % -> %', COALESCE(_row.stolen_count, 0), _before_attacker, _after_attacker, _before_defender, _after_defender;
  END IF;

  DELETE FROM public.competition_catches WHERE user_id = _attacker AND fish_id = 'sardine' AND caught_at > now() - interval '5 minutes';
  DELETE FROM public.fish_stock WHERE ship_id IN (_attacker_ship, _defender_ship);
  DELETE FROM public.fish_caught WHERE user_id = _attacker AND fish_id = 'sardine' AND updated_at > now() - interval '5 minutes';
  DELETE FROM public.ships_owned WHERE id IN (_attacker_ship, _defender_ship);
  IF _old_attacker_level IS NULL THEN DELETE FROM public.user_fish_market WHERE user_id = _attacker; ELSE UPDATE public.user_fish_market SET level = _old_attacker_level WHERE user_id = _attacker; END IF;
  IF _old_defender_level IS NULL THEN DELETE FROM public.user_fish_market WHERE user_id = _defender; ELSE UPDATE public.user_fish_market SET level = _old_defender_level WHERE user_id = _defender; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  DELETE FROM public.competition_catches WHERE user_id = _attacker AND fish_id = 'sardine' AND caught_at > now() - interval '5 minutes';
  DELETE FROM public.fish_stock WHERE ship_id IN (_attacker_ship, _defender_ship);
  DELETE FROM public.ships_owned WHERE id IN (_attacker_ship, _defender_ship);
  IF _attacker IS NOT NULL THEN
    IF _old_attacker_level IS NULL THEN DELETE FROM public.user_fish_market WHERE user_id = _attacker; ELSE UPDATE public.user_fish_market SET level = _old_attacker_level WHERE user_id = _attacker; END IF;
  END IF;
  IF _defender IS NOT NULL THEN
    IF _old_defender_level IS NULL THEN DELETE FROM public.user_fish_market WHERE user_id = _defender; ELSE UPDATE public.user_fish_market SET level = _old_defender_level WHERE user_id = _defender; END IF;
  END IF;
  RAISE;
END;
$function$;

DO $$
BEGIN
  IF NOT public.test_steal_cancel_counter_one_fish() THEN
    RAISE EXCEPTION 'counter-one cancel verification failed';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.test_steal_cancel_counter_one_fish();