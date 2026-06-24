
CREATE OR REPLACE FUNCTION public.activate_golden_fisher()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row record;
  _current timestamptz;
  _new_until timestamptz;
  _base timestamptz;
  _had_inventory boolean := false;
  _tick jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT golden_fisher_until INTO _current FROM public.profiles WHERE id = _uid FOR UPDATE;

  SELECT * INTO _row
  FROM public.inventory
  WHERE user_id = _uid AND item_type = 'crew' AND item_id = 'golden_fisher'
    AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL)
    AND quantity > 0
  ORDER BY acquired_at ASC FOR UPDATE LIMIT 1;

  IF _row.id IS NOT NULL THEN
    _had_inventory := true;
    IF _row.quantity <= 1 THEN
      DELETE FROM public.inventory WHERE id = _row.id;
    ELSE
      UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id;
    END IF;
    _base := GREATEST(COALESCE(_current, now()), now());
    _new_until := _base + interval '24 hours';
  ELSE
    IF _current IS NULL OR _current <= now() THEN
      RAISE EXCEPTION 'no_golden_fisher_in_inventory';
    END IF;
    _new_until := _current;
  END IF;

  UPDATE public.profiles
     SET golden_fisher_until = _new_until,
         golden_fisher_last_activated_at = now(),
         protection_until = GREATEST(COALESCE(protection_until, _new_until), _new_until)
   WHERE id = _uid;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_ends_at = NULL,
         stealing_started_at = NULL
   WHERE stealing_target_user_id = _uid;

  UPDATE public.ships_owned s
     SET at_sea = true,
         fishing_started_at = (now() - (GREATEST(60, COALESCE(c.fishing_seconds, 600)) || ' seconds')::interval)
    FROM public.ship_catalog c
   WHERE c.code = s.catalog_code
     AND s.user_id = _uid
     AND s.in_storage = false
     AND s.destroyed_at IS NULL
     AND (s.repair_ends_at IS NULL OR s.repair_ends_at <= now())
     AND s.stealing_target_user_id IS NULL
     AND s.stealing_ends_at IS NULL;

  _tick := public.golden_fisher_tick(_uid);

  RETURN jsonb_build_object(
    'ok', true,
    'already_active', (_current IS NOT NULL AND _current > now() AND NOT _had_inventory),
    'extended', _had_inventory,
    'until', _new_until,
    'tick', _tick
  );
END;
$function$;

-- Backfill this week's arena scores from existing hatched-dragon attacks
DO $$
DECLARE
  _mult numeric := 1;
  _active boolean := false;
  _ends timestamptz;
  _ws date := (date_trunc('week', (now() AT TIME ZONE 'UTC'))::date);
BEGIN
  SELECT event_active, event_multiplier, event_ends_at
    INTO _active, _mult, _ends
    FROM public.arena_settings LIMIT 1;
  IF NOT (_active IS TRUE AND (_ends IS NULL OR _ends > now())) THEN
    _mult := 1;
  END IF;

  INSERT INTO public.arena_scores (user_id, week_start, score, wins, updated_at)
  SELECT
    a.attacker_id,
    _ws,
    SUM(GREATEST(0::bigint, FLOOR(COALESCE(a.damage_dealt, 0)::numeric * COALESCE(_mult, 1))::bigint)),
    SUM(CASE WHEN a.attacker_won THEN 1 ELSE 0 END),
    now()
  FROM public.attacks a
  WHERE public.dragon_is_hatched(a.attacker_id)
    AND a.created_at >= (date_trunc('week', (now() AT TIME ZONE 'UTC')))
  GROUP BY a.attacker_id
  ON CONFLICT (user_id, week_start) DO UPDATE
    SET score = EXCLUDED.score,
        wins  = EXCLUDED.wins,
        updated_at = now();
END $$;
