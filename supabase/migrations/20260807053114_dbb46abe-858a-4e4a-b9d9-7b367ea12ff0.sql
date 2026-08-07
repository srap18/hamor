CREATE TABLE public.legacy_fixer4_credits (
  user_id uuid PRIMARY KEY,
  remaining integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.legacy_fixer4_credits TO authenticated;
GRANT ALL ON public.legacy_fixer4_credits TO service_role;

ALTER TABLE public.legacy_fixer4_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own legacy fixer credits"
ON public.legacy_fixer4_credits FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER update_legacy_fixer4_credits_updated_at
BEFORE UPDATE ON public.legacy_fixer4_credits
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.legacy_fixer4_credits (user_id, remaining)
SELECT inv.user_id, SUM(GREATEST(inv.quantity, 0))::integer
FROM public.inventory inv
WHERE inv.item_type = 'crew' AND inv.item_id = 'fixer_4'
GROUP BY inv.user_id
HAVING SUM(GREATEST(inv.quantity, 0)) > 0
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.repair_ship_with_crew(_ship_id uuid, _crew_id text)
 RETURNS TABLE(new_hp integer, max_hp integer, repair_ends_at timestamp with time zone, repaired_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _inv record;
  _ship record;
  _heal integer;
  _cur_hp integer;
  _new_hp integer;
  _max integer;
  _total_secs numeric;
  _remaining_secs numeric;
  _new_destroyed timestamptz;
  _new_repair_ends timestamptz;
  _count integer := 0;
  _full boolean := false;
  _legacy boolean := false;
  _r record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _crew_id NOT IN ('fixer_1','fixer_2','fixer_3','fixer_4') THEN RAISE EXCEPTION 'unsupported crew'; END IF;

  SELECT inv.id, inv.quantity INTO _inv
  FROM public.inventory AS inv
  WHERE inv.user_id = _uid
    AND inv.item_type = 'crew'
    AND inv.item_id = _crew_id
    AND (inv.meta IS NULL OR inv.meta->>'assigned_ship_id' IS NULL)
  ORDER BY inv.acquired_at, inv.id
  LIMIT 1 FOR UPDATE;

  IF _inv.id IS NULL OR COALESCE(_inv.quantity, 0) < 1 THEN
    RAISE EXCEPTION 'no such crew';
  END IF;

  IF _crew_id = 'fixer_4' THEN
    SELECT (c.remaining > 0) INTO _legacy
    FROM public.legacy_fixer4_credits c
    WHERE c.user_id = _uid
    FOR UPDATE;
    _legacy := COALESCE(_legacy, false);

    FOR _r IN
      SELECT so.* FROM public.ships_owned AS so
      WHERE so.user_id = _uid
        AND (COALESCE(so.hp, 0) < COALESCE(so.max_hp, 100) OR so.destroyed_at IS NOT NULL OR so.repair_ends_at IS NOT NULL)
      FOR UPDATE
    LOOP
      _max := COALESCE(_r.max_hp, 100);
      IF _r.destroyed_at IS NOT NULL AND _r.repair_ends_at IS NOT NULL THEN
        _total_secs := EXTRACT(EPOCH FROM (_r.repair_ends_at - _r.destroyed_at))::numeric;
        _cur_hp := LEAST(_max, GREATEST(
          COALESCE(_r.hp, 0),
          FLOOR(_max::numeric * EXTRACT(EPOCH FROM (now() - _r.destroyed_at))::numeric
                / NULLIF(_total_secs, 0))::integer
        ));
      ELSE
        _cur_hp := COALESCE(_r.hp, 0);
        _total_secs := NULL;
      END IF;

      IF _legacy THEN
        _new_hp := _max;
      ELSE
        _new_hp := LEAST(_max, _cur_hp + 140000);
      END IF;
      _full := _new_hp >= _max;

      IF _full THEN
        _new_destroyed := NULL;
        _new_repair_ends := NULL;
      ELSIF _total_secs IS NOT NULL AND _total_secs > 0 THEN
        _remaining_secs := _total_secs * (1.0 - _new_hp::numeric / _max::numeric);
        _new_repair_ends := now() + make_interval(secs => _remaining_secs);
        _new_destroyed := _new_repair_ends - make_interval(secs => _total_secs);
      ELSE
        _new_destroyed := _r.destroyed_at;
        _new_repair_ends := _r.repair_ends_at;
      END IF;

      UPDATE public.ships_owned AS so
         SET hp = _new_hp,
             destroyed_at = _new_destroyed,
             repair_ends_at = _new_repair_ends,
             at_sea = CASE WHEN _full THEN false ELSE so.at_sea END,
             fishing_started_at = CASE WHEN _full THEN NULL ELSE so.fishing_started_at END
       WHERE so.id = _r.id;

      _count := _count + 1;
    END LOOP;

    IF _count < 1 THEN RAISE EXCEPTION 'no ships need repair'; END IF;

    IF _legacy THEN
      UPDATE public.legacy_fixer4_credits c
         SET remaining = GREATEST(c.remaining - 1, 0)
       WHERE c.user_id = _uid;
    END IF;

    IF _inv.quantity <= 1 THEN
      DELETE FROM public.inventory AS inv WHERE inv.id = _inv.id;
    ELSE
      UPDATE public.inventory AS inv SET quantity = inv.quantity - 1 WHERE inv.id = _inv.id;
    END IF;

    RETURN QUERY SELECT NULL::integer, NULL::integer, NULL::timestamptz, _count;
    RETURN;
  END IF;

  _heal := CASE _crew_id WHEN 'fixer_1' THEN 1000 WHEN 'fixer_2' THEN 5000 ELSE 70000 END;

  SELECT so.* INTO _ship FROM public.ships_owned AS so
   WHERE so.id = _ship_id AND so.user_id = _uid
   FOR UPDATE;
  IF _ship.id IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;

  _max := COALESCE(_ship.max_hp, 100);
  IF _ship.destroyed_at IS NOT NULL AND _ship.repair_ends_at IS NOT NULL THEN
    _total_secs := EXTRACT(EPOCH FROM (_ship.repair_ends_at - _ship.destroyed_at))::numeric;
    _cur_hp := LEAST(_max, GREATEST(
      COALESCE(_ship.hp, 0),
      FLOOR(_max::numeric * EXTRACT(EPOCH FROM (now() - _ship.destroyed_at))::numeric
            / NULLIF(_total_secs, 0))::integer
    ));
  ELSE
    _cur_hp := COALESCE(_ship.hp, 0);
    _total_secs := NULL;
  END IF;

  IF _cur_hp >= _max THEN RAISE EXCEPTION 'ship not damaged'; END IF;

  _new_hp := LEAST(_max, _cur_hp + _heal);
  _full := _new_hp >= _max;

  IF _full THEN
    _new_destroyed := NULL;
    _new_repair_ends := NULL;
  ELSIF _total_secs IS NOT NULL AND _total_secs > 0 THEN
    _remaining_secs := _total_secs * (1.0 - _new_hp::numeric / _max::numeric);
    _new_repair_ends := now() + make_interval(secs => _remaining_secs);
    _new_destroyed := _new_repair_ends - make_interval(secs => _total_secs);
  ELSE
    _new_destroyed := _ship.destroyed_at;
    _new_repair_ends := _ship.repair_ends_at;
  END IF;

  UPDATE public.ships_owned AS so
     SET hp = _new_hp,
         destroyed_at = _new_destroyed,
         repair_ends_at = _new_repair_ends,
         at_sea = CASE WHEN _full THEN false ELSE so.at_sea END,
         fishing_started_at = CASE WHEN _full THEN NULL ELSE so.fishing_started_at END
   WHERE so.id = _ship.id;

  IF _inv.quantity <= 1 THEN
    DELETE FROM public.inventory AS inv WHERE inv.id = _inv.id;
  ELSE
    UPDATE public.inventory AS inv SET quantity = inv.quantity - 1 WHERE inv.id = _inv.id;
  END IF;

  RETURN QUERY SELECT _new_hp, _max, _new_repair_ends, 1;
END;
$function$;