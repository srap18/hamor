
CREATE TABLE IF NOT EXISTS public.user_fish_market (
  user_id uuid PRIMARY KEY,
  level integer NOT NULL DEFAULT 1,
  upgrading_to integer,
  upgrade_started_at timestamptz,
  upgrade_ends_at timestamptz,
  upgrade_cost_coins bigint DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_fish_market ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ufm_select_self_or_admin ON public.user_fish_market;
CREATE POLICY ufm_select_self_or_admin ON public.user_fish_market FOR SELECT USING (auth.uid() = user_id OR is_admin(auth.uid()));

DROP POLICY IF EXISTS ufm_insert_self ON public.user_fish_market;
CREATE POLICY ufm_insert_self ON public.user_fish_market FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS ufm_update_self ON public.user_fish_market;
CREATE POLICY ufm_update_self ON public.user_fish_market FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS ufm_admin_all ON public.user_fish_market;
CREATE POLICY ufm_admin_all ON public.user_fish_market FOR ALL USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.fish_market_upgrade_cost(_level integer)
RETURNS TABLE(cost_coins bigint, seconds integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (500 * power(1.6, GREATEST(_level,1) - 1))::bigint AS cost_coins,
    (30 + GREATEST(_level,1) * 60)::int AS seconds;
$$;

CREATE OR REPLACE FUNCTION public.finalize_fish_market_upgrades()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.user_fish_market
  SET level = upgrading_to,
      upgrading_to = NULL,
      upgrade_started_at = NULL,
      upgrade_ends_at = NULL,
      upgrade_cost_coins = NULL,
      updated_at = now()
  WHERE upgrade_ends_at IS NOT NULL
    AND upgrade_ends_at <= now()
    AND upgrading_to IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.fish_market_start_upgrade()
RETURNS TABLE(new_level integer, ends_at timestamptz, cost_coins bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE _uid uuid := auth.uid(); _cur record; _cost bigint; _secs int; _end timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  PERFORM public.finalize_fish_market_upgrades();
  SELECT * INTO _cur FROM public.user_fish_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL THEN
    INSERT INTO public.user_fish_market(user_id, level) VALUES (_uid, 1)
    ON CONFLICT DO NOTHING;
    SELECT * INTO _cur FROM public.user_fish_market WHERE user_id = _uid FOR UPDATE;
  END IF;
  IF _cur.upgrading_to IS NOT NULL THEN RAISE EXCEPTION 'already upgrading'; END IF;
  IF _cur.level >= 30 THEN RAISE EXCEPTION 'max level'; END IF;
  SELECT muc.cost_coins, muc.seconds INTO _cost, _secs FROM public.fish_market_upgrade_cost(_cur.level) AS muc;
  _end := now() + make_interval(secs => _secs);
  PERFORM public._mutate_currency(_uid, -_cost, 0, 0, 0);
  UPDATE public.user_fish_market
    SET upgrading_to = _cur.level + 1,
        upgrade_started_at = now(),
        upgrade_ends_at = _end,
        upgrade_cost_coins = _cost,
        updated_at = now()
    WHERE user_id = _uid;
  RETURN QUERY SELECT (_cur.level + 1), _end, _cost;
END $function$;

CREATE OR REPLACE FUNCTION public.fish_market_finish_upgrade_with_gems()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE _uid uuid := auth.uid(); _cur record; _secs_left int; _gems int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _cur FROM public.user_fish_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL OR _cur.upgrading_to IS NULL THEN RAISE EXCEPTION 'no upgrade'; END IF;
  _secs_left := GREATEST(0, EXTRACT(EPOCH FROM (_cur.upgrade_ends_at - now()))::int);
  _gems := GREATEST(1, CEIL(_secs_left::numeric / 60))::int;
  PERFORM public._mutate_currency(_uid, 0, -_gems, 0, 0);
  UPDATE public.user_fish_market
    SET level = upgrading_to,
        upgrading_to = NULL,
        upgrade_started_at = NULL,
        upgrade_ends_at = NULL,
        upgrade_cost_coins = NULL,
        updated_at = now()
    WHERE user_id = _uid;
  RETURN _gems;
END $function$;
