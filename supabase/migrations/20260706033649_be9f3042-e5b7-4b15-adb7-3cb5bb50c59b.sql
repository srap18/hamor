
-- 1) Add cashback_pct column
ALTER TABLE public.elite_vip_tier_config
  ADD COLUMN IF NOT EXISTS cashback_pct smallint NOT NULL DEFAULT 0;

UPDATE public.elite_vip_tier_config SET cashback_pct = CASE level
  WHEN 1 THEN 5 WHEN 2 THEN 10 WHEN 3 THEN 15 WHEN 4 THEN 20 WHEN 5 THEN 30
  ELSE cashback_pct END;

-- 2) Cashback helper
CREATE OR REPLACE FUNCTION public.award_vip_cashback(_uid uuid, _gold_spent bigint, _source text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _lvl int; _pct int; _amt bigint;
BEGIN
  IF _uid IS NULL OR _gold_spent IS NULL OR _gold_spent <= 0 THEN RETURN 0; END IF;
  SELECT COALESCE(elite_vip_level, 0) INTO _lvl FROM public.profiles WHERE id = _uid;
  IF _lvl < 1 THEN RETURN 0; END IF;
  SELECT COALESCE(cashback_pct, 0) INTO _pct FROM public.elite_vip_tier_config WHERE level = _lvl;
  IF _pct <= 0 THEN RETURN 0; END IF;
  _amt := FLOOR(_gold_spent::numeric * _pct / 100.0)::bigint;
  IF _amt <= 0 THEN RETURN 0; END IF;
  PERFORM public._mutate_currency(_uid, _amt, 0, 0, 0);
  RETURN _amt;
END $$;

GRANT EXECUTE ON FUNCTION public.award_vip_cashback(uuid, bigint, text) TO authenticated, service_role;

-- 3) Wire cashback into market_start_upgrade (adds cashback after debit; no other changes)
CREATE OR REPLACE FUNCTION public.market_start_upgrade()
 RETURNS TABLE(new_level integer, ends_at timestamp with time zone, cost_coins bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _cur record; _cost bigint; _secs int; _end timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  PERFORM public.finalize_market_upgrades();
  SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  IF _cur IS NULL THEN
    INSERT INTO public.user_market(user_id, level) VALUES (_uid, 1)
    ON CONFLICT DO NOTHING;
    SELECT * INTO _cur FROM public.user_market WHERE user_id = _uid FOR UPDATE;
  END IF;
  IF _cur.upgrading_to IS NOT NULL THEN RAISE EXCEPTION 'already upgrading'; END IF;
  IF _cur.level >= 30 THEN RAISE EXCEPTION 'max level'; END IF;
  SELECT muc.cost_coins, muc.seconds INTO _cost, _secs FROM public.market_upgrade_cost(_cur.level) AS muc;
  _end := now() + make_interval(secs => _secs);
  PERFORM public._mutate_currency(_uid, -_cost, 0, 0, 0);
  PERFORM public.award_vip_cashback(_uid, _cost, 'market_upgrade');
  UPDATE public.user_market
    SET upgrading_to = _cur.level + 1,
        upgrade_started_at = now(),
        upgrade_ends_at = _end,
        upgrade_cost_coins = _cost,
        updated_at = now()
    WHERE user_id = _uid;
  RETURN QUERY SELECT (_cur.level + 1), _end, _cost;
END $function$;

-- 4) Wire cashback into fish_market_start_upgrade
CREATE OR REPLACE FUNCTION public.fish_market_start_upgrade()
 RETURNS TABLE(new_level integer, ends_at timestamp with time zone, cost_coins bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  PERFORM public.award_vip_cashback(_uid, _cost, 'fish_market_upgrade');
  UPDATE public.user_fish_market
    SET upgrading_to = _cur.level + 1,
        upgrade_started_at = now(),
        upgrade_ends_at = _end,
        upgrade_cost_coins = _cost,
        updated_at = now()
    WHERE user_id = _uid;
  RETURN QUERY SELECT (_cur.level + 1), _end, _cost;
END $function$;

-- 5) Reduce VIP login broadcast throttle from 10min to 2min
CREATE OR REPLACE FUNCTION public.post_elite_vip_login_broadcast()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO _profile FROM public.profiles WHERE id = auth.uid();
  IF _profile.id IS NULL OR COALESCE(_profile.elite_vip_level, 0) < 3 THEN
    RETURN;
  END IF;

  IF COALESCE(_profile.elite_vip_login_broadcast_enabled, true) = false THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.elite_vip_login_broadcasts
    WHERE user_id = _profile.id AND created_at > now() - interval '2 minutes'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.elite_vip_login_broadcasts
    (user_id, display_name, elite_vip_level, avatar_emoji, avatar_url)
  VALUES
    (_profile.id, _profile.display_name, _profile.elite_vip_level,
     _profile.avatar_emoji, _profile.avatar_url);

  PERFORM public.cleanup_elite_login_broadcasts();
END;
$function$;
