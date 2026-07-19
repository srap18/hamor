
-- Fix: Phoenix ships (template_id=31 in ships_owned) were bypassing the
-- attack fleet requirement because pvp_fleet_count used GREATEST(template_id, market_level_required, ...).
-- Now we trust the catalog's market_level_required as the authoritative ship level, and only
-- fall back to template_id / regexp when the catalog row is missing.
-- Also unify the requirement error message across both weapon paths (rockets + nukes + ad bombs).

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
    AND COALESCE(
          sc.market_level_required,
          NULLIF((regexp_match(COALESCE(s.catalog_code, ''), '^ship-lvl-([0-9]+)$'))[1]::integer, 0),
          s.template_id,
          0
        ) >= GREATEST(6, public.effective_market_level(_user_id) - 3);
$function$;

-- Unified Arabic message used by BOTH the attacker-side and generic requirement error.
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
    RETURN 'لا يمكنك الهجوم: تحتاج 3 سفن مؤهلة على الأقل مستواها ' || _min_lvl::text
      || ' أو أعلى (لا يقل عن مستوى سوق السفن الحالي بأكثر من 4 مستويات) مبحرة وفي وضع الصيد. سفن العنقاء تُحسب مستوى 14. استخدم سفن مناسبة لإعادة تفعيل الهجمات.';
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.pvp_requirement_error(_user_id uuid, _actor_label text DEFAULT 'attacker'::text)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _market integer;
  _fleet integer;
  _min_lvl int;
BEGIN
  _market := public.effective_market_level(_user_id);
  _fleet := public.pvp_fleet_count(_user_id);

  IF _market < 6 THEN
    RETURN COALESCE(_actor_label, 'attacker') || ' market level under 6: current=' || _market::text;
  END IF;
  IF _fleet < 3 THEN
    IF COALESCE(_actor_label,'attacker') = 'attacker' THEN
      _min_lvl := GREATEST(6, _market - 3);
      RETURN 'لا يمكنك الهجوم: تحتاج 3 سفن مؤهلة على الأقل مستواها ' || _min_lvl::text
        || ' أو أعلى (لا يقل عن مستوى سوق السفن الحالي بأكثر من 4 مستويات) مبحرة وفي وضع الصيد. سفن العنقاء تُحسب مستوى 14. استخدم سفن مناسبة لإعادة تفعيل الهجمات.';
    END IF;
    RETURN COALESCE(_actor_label, 'attacker')
      || ' needs 3 ships level 6+ sailing and fishing: has=' || _fleet::text;
  END IF;
  RETURN NULL;
END
$function$;
