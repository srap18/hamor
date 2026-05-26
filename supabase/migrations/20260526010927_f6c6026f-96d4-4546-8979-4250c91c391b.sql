
-- Lock sensitive ship columns: players cannot directly change HP, repair timers,
-- destruction state, max HP, template, or owner from the client.
REVOKE UPDATE ON public.ships_owned FROM authenticated, anon;
GRANT UPDATE (at_sea) ON public.ships_owned TO authenticated;

-- Longer repair durations: level 1 = 30 min, level 5 ≈ 2h, level 10 ≈ 8h,
-- level 20 ≈ 32h, level 30 = 72h (capped at 3 days).
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer)
 RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _new_hp int;
  _owner uuid;
  _repair_secs int;
  _tpl int;
  _repair_ends timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT user_id, template_id INTO _owner, _tpl
    FROM public.ships_owned WHERE id = _ship_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = auth.uid() THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  _tpl := COALESCE(_tpl, 1);
  -- lvl 1 = 1800s (30min), lvl 30 ≈ 259200s (72h), capped 3 days.
  _repair_secs := LEAST(259200, GREATEST(1800, _tpl * _tpl * 288));

  UPDATE public.ships_owned
    SET hp = GREATEST(0, COALESCE(hp,100) - _damage),
        destroyed_at = CASE WHEN GREATEST(0, COALESCE(hp,100) - _damage) = 0 AND destroyed_at IS NULL THEN now() ELSE destroyed_at END,
        repair_ends_at = CASE WHEN GREATEST(0, COALESCE(hp,100) - _damage) = 0 AND repair_ends_at IS NULL THEN now() + make_interval(secs => _repair_secs) ELSE repair_ends_at END
  WHERE id = _ship_id
  RETURNING hp, ships_owned.repair_ends_at INTO _new_hp, _repair_ends;
  RETURN QUERY SELECT _new_hp, _new_hp = 0, _repair_ends;
END;
$function$;
