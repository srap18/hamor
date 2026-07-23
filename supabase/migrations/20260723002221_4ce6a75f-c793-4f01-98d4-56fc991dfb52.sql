
-- New helper: highest ship level a player owns (any non-destroyed ship,
-- including storage). Buying a mega-ship immediately raises this value.
CREATE OR REPLACE FUNCTION public.pvp_max_ship_level(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(MAX(COALESCE(
    sc.market_level_required,
    NULLIF((regexp_match(COALESCE(s.catalog_code, ''), '^ship-lvl-([0-9]+)$'))[1]::integer, 0),
    s.template_id,
    0
  )), 0)::int
  FROM public.ships_owned s
  LEFT JOIN public.ship_catalog sc ON sc.code = s.catalog_code
  WHERE s.user_id = _user_id
    AND s.destroyed_at IS NULL
$$;

-- Replace gap check: use the MAX ship level either side owns so that a
-- single high-tier ship can't be used to farm much lower players.
-- Still keeps the previous "min of top-3 eligible" as a secondary trigger
-- (whichever gap is larger wins) so we don't weaken existing protection.
CREATE OR REPLACE FUNCTION public.pvp_level_gap_error(_attacker uuid, _defender uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _a_min int;
  _d_min int;
  _a_max int;
  _d_max int;
  _gap int;
  _gap_max int;
BEGIN
  IF _attacker IS NULL OR _defender IS NULL THEN RETURN NULL; END IF;
  IF public.is_admin(_attacker) THEN RETURN NULL; END IF;

  _a_min := public.pvp_min_eligible_ship_level(_attacker);
  _d_min := public.pvp_min_eligible_ship_level(_defender);
  _a_max := public.pvp_max_ship_level(_attacker);
  _d_max := public.pvp_max_ship_level(_defender);

  _gap := CASE
    WHEN _a_min IS NULL OR _d_min IS NULL THEN 0
    ELSE ABS(_a_min - _d_min)
  END;
  _gap_max := ABS(COALESCE(_a_max, 0) - COALESCE(_d_max, 0));

  IF GREATEST(_gap, _gap_max) >= 15 THEN
    RETURN 'الحماية مفعّلة: فرق مستوى السفن بينكما ' || GREATEST(_gap, _gap_max)::text
      || ' مستوى (15 أو أكثر). لا يمكن الهجوم في الاتجاهين — لا يمكن استخدام سفينة قوية جدًا ضد لاعبين أقل بكثير.';
  END IF;
  RETURN NULL;
END $$;
