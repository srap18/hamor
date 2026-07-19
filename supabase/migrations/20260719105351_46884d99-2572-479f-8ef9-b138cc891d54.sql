
-- Anti-exploit: block attacks with ships more than 3 levels below the attacker's current ship-market level.
-- Implemented by tightening pvp_fleet_count so only "in-range" ships count toward the required 3.
-- Low-level ships remain valid targets for defenders — this only restricts the attacker's own fleet.

CREATE OR REPLACE FUNCTION public.pvp_fleet_count(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(COUNT(*)::integer, 0)
  FROM public.ships_owned s
  LEFT JOIN public.ship_catalog sc ON sc.code = s.catalog_code
  WHERE s.user_id = _user_id
    AND COALESCE(s.in_storage, false) = false
    AND COALESCE(s.at_sea, false) = true
    AND s.fishing_started_at IS NOT NULL
    AND s.destroyed_at IS NULL
    AND (s.repair_ends_at IS NULL OR s.repair_ends_at <= now())
    AND COALESCE(s.hp, 0) > 1
    AND (s.stealing_ends_at IS NULL OR s.stealing_ends_at <= now())
    AND GREATEST(
      COALESCE(s.template_id, 0),
      COALESCE(sc.market_level_required, 0),
      COALESCE((regexp_match(COALESCE(s.catalog_code, ''), '^ship-lvl-([0-9]+)$'))[1]::integer, 0),
      CASE WHEN COALESCE(s.max_hp, 0) >= 1800 THEN 6 ELSE 0 END
    ) >= GREATEST(6, public.effective_market_level(_user_id) - 3)
$function$;

CREATE OR REPLACE FUNCTION public.pvp_attacker_requirement_error(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _market int;
  _min_lvl int;
BEGIN
  _market := public.effective_market_level(_user_id);
  IF _market < 6 THEN
    RETURN 'attacker market level under 6: current=' || _market::text;
  END IF;
  IF NOT public.has_pvp_attack_fleet(_user_id) THEN
    _min_lvl := GREATEST(6, _market - 3);
    RETURN 'لا يمكنك الهجوم: يجب أن يكون لديك ٣ سفن على الأقل مستواها ' || _min_lvl::text
      || ' أو أعلى (لا يقل عن مستوى سوق السفن الحالي بأكثر من ٤ مستويات) مبحرة وفي وضع الصيد. استخدم سفن مناسبة لإعادة تفعيل الهجمات.';
  END IF;
  RETURN NULL;
END $function$;
