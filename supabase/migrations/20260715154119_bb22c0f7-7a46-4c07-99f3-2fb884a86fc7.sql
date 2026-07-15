
-- Unify PvP attack requirements across all attack paths (regular, nuke, ad bomb).
-- Enforce: attacker must have >=3 ships (level 6+), currently at sea + fishing + not destroyed + hp>1.
-- Treat hp<=1 as functionally destroyed to close the nuke-cap loophole.

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
    ) >= 6
$function$;

CREATE OR REPLACE FUNCTION public.has_pvp_attack_fleet(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.pvp_fleet_count(_user_id) >= 3
$function$;

CREATE OR REPLACE FUNCTION public.attacker_has_destroyed_ship(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE user_id = _user_id
       AND COALESCE(in_storage, false) = false
       AND (
         destroyed_at IS NOT NULL
         OR (repair_ends_at IS NOT NULL AND repair_ends_at > now())
         OR COALESCE(hp, 0) <= 1
       )
  )
$function$;

CREATE OR REPLACE FUNCTION public.pvp_requirement_error(_user_id uuid, _actor_label text DEFAULT 'attacker'::text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _market integer;
  _fleet integer;
BEGIN
  _market := public.effective_market_level(_user_id);
  _fleet := public.pvp_fleet_count(_user_id);

  IF _market < 6 THEN
    RETURN COALESCE(_actor_label, 'attacker') || ' market level under 6: current=' || _market::text;
  END IF;
  IF _fleet < 3 THEN
    RETURN COALESCE(_actor_label, 'attacker')
      || ' needs 3 ships level 6+ sailing and fishing: has=' || _fleet::text;
  END IF;
  RETURN NULL;
END
$function$;
