CREATE OR REPLACE FUNCTION public._award_fleet_combo(_uid uuid, _ship_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _c record; _unit bigint; _remaining bigint; _give integer;
BEGIN
  FOR _c IN
    SELECT c.* FROM public.fleet_combos c
    WHERE c.active = true
      AND EXISTS (SELECT 1 FROM public.fleet_combo_ships s2 WHERE s2.combo_id = c.id)
      AND EXISTS (
        SELECT 1 FROM public.fleet_combo_ships s3
        JOIN public.ships_owned so ON so.id = _ship_id
        WHERE s3.combo_id = c.id
          AND COALESCE(so.catalog_code, 'ship-lvl-' || COALESCE(so.template_id, 0)) = s3.catalog_code
      )
      -- every required ship must be fishing now, be the collected ship,
      -- or have completed its trip within the last 15 minutes (same fleet run)
      AND NOT EXISTS (
        SELECT 1 FROM public.fleet_combo_ships s
        WHERE s.combo_id = c.id
          AND NOT EXISTS (
            SELECT 1 FROM public.ships_owned so2
            WHERE so2.user_id = _uid
              AND (
                so2.id = _ship_id
                OR so2.fishing_started_at IS NOT NULL
                OR so2.last_fishing_reward_at > now() - interval '15 minutes'
              )
              AND COALESCE(so2.catalog_code, 'ship-lvl-' || COALESCE(so2.template_id, 0)) = s.catalog_code
          )
      )
      -- cooldown / per-trip dedupe (min 5 minutes)
      AND NOT EXISTS (
        SELECT 1 FROM public.fleet_combo_claims cl
        WHERE cl.combo_id = c.id AND cl.user_id = _uid
          AND cl.created_at > now() - make_interval(mins => GREATEST(5, c.cooldown_minutes))
      )
  LOOP
    IF (random() * 100) > GREATEST(0, LEAST(100, _c.chance_pct)) THEN CONTINUE; END IF;

    _remaining := public.user_market_remaining(_uid);
    IF _remaining <= 0 THEN RETURN; END IF;
    _give := LEAST(GREATEST(1, _c.qty)::bigint, _remaining)::int;

    INSERT INTO public.fish_caught(user_id, fish_id, quantity, total_caught)
    VALUES (_uid, _c.fish_id, _give, _give)
    ON CONFLICT ON CONSTRAINT fish_caught_user_id_fish_id_key
    DO UPDATE SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
                  total_caught = public.fish_caught.total_caught + EXCLUDED.total_caught,
                  updated_at = now();

    SELECT COALESCE(current_price, 0)::bigint INTO _unit
      FROM public.fish_market_prices WHERE fish_market_prices.fish_id = _c.fish_id LIMIT 1;

    INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
    VALUES (_uid, _c.fish_id, _ship_id, now(), COALESCE(_unit, 0), _give);

    INSERT INTO public.fleet_combo_claims(combo_id, user_id, fish_id, qty)
    VALUES (_c.id, _uid, _c.fish_id, _give);
  END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION public.my_active_fleet_combos()
 RETURNS TABLE(combo_id uuid, name text, fish_id text, qty integer, chance_pct integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT c.id, c.name, c.fish_id, c.qty, c.chance_pct
  FROM public.fleet_combos c
  WHERE c.active = true
    AND NOT EXISTS (
      SELECT 1 FROM public.fleet_combo_ships s
      WHERE s.combo_id = c.id
        AND NOT EXISTS (
          SELECT 1 FROM public.ships_owned so
          WHERE so.user_id = auth.uid()
            AND (so.fishing_started_at IS NOT NULL
                 OR so.last_fishing_reward_at > now() - interval '15 minutes')
            AND COALESCE(so.catalog_code, 'ship-lvl-' || COALESCE(so.template_id, 0)) = s.catalog_code
        )
    )
    AND EXISTS (SELECT 1 FROM public.fleet_combo_ships s2 WHERE s2.combo_id = c.id);
$function$;

CREATE OR REPLACE FUNCTION public.my_recent_fleet_combo_claims(_since_seconds integer DEFAULT 90)
 RETURNS TABLE(combo_id uuid, name text, fish_id text, qty integer, created_at timestamptz)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT cl.combo_id, c.name, cl.fish_id, cl.qty, cl.created_at
  FROM public.fleet_combo_claims cl
  JOIN public.fleet_combos c ON c.id = cl.combo_id
  WHERE cl.user_id = auth.uid()
    AND cl.created_at > now() - make_interval(secs => GREATEST(5, _since_seconds))
  ORDER BY cl.created_at DESC
  LIMIT 5;
$function$;

GRANT EXECUTE ON FUNCTION public.my_recent_fleet_combo_claims(integer) TO authenticated;