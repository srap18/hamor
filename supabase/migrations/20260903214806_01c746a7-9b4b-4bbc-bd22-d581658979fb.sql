CREATE OR REPLACE FUNCTION public.pvp_tier_level(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(MAX(COALESCE(
    sc.market_level_required,
    NULLIF((regexp_match(COALESCE(s.catalog_code, ''), '^ship-lvl-([0-9]+)$'))[1]::integer, 0),
    s.template_id,
    0
  )), 0)::int
  FROM public.ships_owned s
  LEFT JOIN public.ship_catalog sc ON sc.code = s.catalog_code
  WHERE s.user_id = _user_id
    AND COALESCE(s.in_storage, false) = false
$function$;

GRANT EXECUTE ON FUNCTION public.pvp_tier_level(uuid) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.pvp_pair_block_error(_attacker uuid, _defender uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _e text; _a int; _d int;
BEGIN
  IF _attacker IS NULL OR _defender IS NULL THEN RETURN NULL; END IF;
  IF public.is_admin(_attacker) THEN RETURN NULL; END IF;
  _e := public.pvp_attack_ready_error(_attacker);
  IF _e IS NOT NULL THEN RETURN _e; END IF;
  IF public.pvp_is_immune(_defender) THEN
    RETURN '🛡️ هذا اللاعب داخل الحصانة ولا يمكن مهاجمته.';
  END IF;

  _a := public.pvp_tier_level(_attacker);
  _d := public.pvp_tier_level(_defender);
  IF _a > 0 AND _d > 0 AND abs(_a - _d) >= 15 THEN
    RETURN '🚫 فرق الفئات كبير: أسطولك مستوى ' || _a::text || ' وأسطول الخصم مستوى ' || _d::text || ' (الفرق 15 مستوى أو أكثر) — الهجوم ممنوع بينكما.';
  END IF;

  RETURN NULL;
END $function$;