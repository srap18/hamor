
-- 1) Backfill: any user whose inventory has a golden_fisher with future expires_at gets profiles.golden_fisher_until set.
UPDATE public.profiles p
SET golden_fisher_until = GREATEST(
  COALESCE(p.golden_fisher_until, now()),
  (i.meta->>'expires_at')::timestamptz
)
FROM public.inventory i
WHERE i.user_id = p.id
  AND i.item_type = 'crew'
  AND i.item_id = 'golden_fisher'
  AND i.meta ? 'expires_at'
  AND (i.meta->>'expires_at')::timestamptz > now()
  AND (p.golden_fisher_until IS NULL OR p.golden_fisher_until < (i.meta->>'expires_at')::timestamptz);

-- 2) Update tick to also treat inventory-assigned golden_fisher (with valid expires_at) as active.
CREATE OR REPLACE FUNCTION public.golden_fisher_tick(_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ship record;
  _cat record;
  _pool jsonb;
  _pool_len int;
  _chosen text;
  _qty int;
  _cycles int := 0;
  _ships_processed int := 0;
  _now timestamptz := now();
  _elapsed int;
  _full_cycles int;
  _is_active boolean;
BEGIN
  SELECT (
    (golden_fisher_until IS NOT NULL AND golden_fisher_until > _now)
    OR EXISTS (
      SELECT 1 FROM public.inventory i
      WHERE i.user_id = _user
        AND i.item_type = 'crew'
        AND i.item_id = 'golden_fisher'
        AND i.meta ? 'expires_at'
        AND (i.meta->>'expires_at')::timestamptz > _now
    )
  ) INTO _is_active
  FROM public.profiles WHERE id = _user;

  IF NOT COALESCE(_is_active, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  FOR _ship IN
    SELECT * FROM public.ships_owned
    WHERE user_id = _user
      AND in_storage = false
      AND destroyed_at IS NULL
      AND (repair_ends_at IS NULL OR repair_ends_at <= _now)
    FOR UPDATE
  LOOP
    SELECT * INTO _cat FROM public.ship_catalog WHERE code = _ship.catalog_code;
    IF _cat.id IS NULL THEN CONTINUE; END IF;
    _pool := COALESCE(_cat.fish_pool, '[]'::jsonb);
    _pool_len := jsonb_array_length(_pool);
    IF _pool_len = 0 OR _cat.fishing_seconds <= 0 THEN CONTINUE; END IF;

    IF _ship.fishing_started_at IS NULL THEN
      UPDATE public.ships_owned
        SET fishing_started_at = _now, at_sea = true
        WHERE id = _ship.id;
      _ships_processed := _ships_processed + 1;
      CONTINUE;
    END IF;

    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (_now - _ship.fishing_started_at))::int);
    _full_cycles := _elapsed / _cat.fishing_seconds;
    IF _full_cycles <= 0 THEN CONTINUE; END IF;
    IF _full_cycles > 20 THEN _full_cycles := 20; END IF;

    FOR i IN 1.._full_cycles LOOP
      _chosen := _pool->>floor(random() * _pool_len)::int;
      _qty := GREATEST(1, (_cat.fishing_power / 100)::int);

      INSERT INTO public.fish_caught (user_id, fish_id, quantity, total_caught, updated_at)
      VALUES (_user, _chosen, _qty, _qty, _now)
      ON CONFLICT (user_id, fish_id) DO UPDATE
        SET quantity = public.fish_caught.quantity + EXCLUDED.quantity,
            total_caught = public.fish_caught.total_caught + EXCLUDED.quantity,
            updated_at = _now;

      _cycles := _cycles + 1;
    END LOOP;

    UPDATE public.ships_owned
      SET fishing_started_at = _now,
          at_sea = true
      WHERE id = _ship.id;
    _ships_processed := _ships_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'cycles', _cycles, 'ships', _ships_processed);
END $function$;
