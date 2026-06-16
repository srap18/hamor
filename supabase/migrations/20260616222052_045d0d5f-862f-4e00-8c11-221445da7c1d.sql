
-- 1) Block golden_fisher from per-ship assignment + keep dedup rules
CREATE OR REPLACE FUNCTION public.assign_crew_to_ship(_ship_id uuid, _crew_id text)
RETURNS TABLE(inventory_id uuid, expires_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _ship_owner uuid;
  _inv_id uuid;
  _qty integer;
  _assigned_at timestamptz := now();
  _expires timestamptz := now() + interval '24 hours';
  _new_id uuid;
  _raider record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _ship_id IS NULL THEN RAISE EXCEPTION 'missing ship'; END IF;
  IF _crew_id IS NULL OR length(_crew_id) = 0 THEN RAISE EXCEPTION 'missing crew'; END IF;
  IF _crew_id IN ('fixer_1','fixer_2','fixer_3','fixer_4') THEN
    RAISE EXCEPTION 'fixer crew is instant-use only';
  END IF;
  IF _crew_id = 'golden_fisher' THEN
    RAISE EXCEPTION 'golden_fisher is account-wide, not per-ship';
  END IF;

  SELECT user_id INTO _ship_owner FROM public.ships_owned WHERE id = _ship_id FOR UPDATE;
  IF _ship_owner IS NULL OR _ship_owner <> _uid THEN RAISE EXCEPTION 'not your ship'; END IF;

  DELETE FROM public.inventory
  WHERE user_id = _uid AND item_type = 'crew' AND item_id = _crew_id
    AND meta->>'assigned_ship_id' = _ship_id::text
    AND (meta->>'expires_at') IS NOT NULL
    AND (meta->>'expires_at')::timestamptz <= now();

  IF _crew_id = 'trader' THEN
    -- Trader is single-active across the whole fleet
    IF EXISTS (
      SELECT 1 FROM public.inventory
      WHERE user_id = _uid AND item_type = 'crew' AND item_id = _crew_id
        AND meta->>'assigned_ship_id' IS NOT NULL
        AND ((meta->>'expires_at') IS NULL OR (meta->>'expires_at')::timestamptz > now())
    ) THEN RAISE EXCEPTION 'crew already active globally'; END IF;
  ELSE
    -- All other crews: reject duplicate of the same type on the same ship
    IF EXISTS (
      SELECT 1 FROM public.inventory
      WHERE user_id = _uid AND item_type = 'crew' AND item_id = _crew_id
        AND meta->>'assigned_ship_id' = _ship_id::text
        AND ((meta->>'expires_at') IS NULL OR (meta->>'expires_at')::timestamptz > now())
    ) THEN RAISE EXCEPTION 'ship already has this crew'; END IF;
  END IF;

  SELECT id, quantity INTO _inv_id, _qty
  FROM public.inventory
  WHERE user_id = _uid AND item_type = 'crew' AND item_id = _crew_id AND quantity > 0
    AND (meta IS NULL OR meta->>'assigned_ship_id' IS NULL)
  ORDER BY acquired_at, id LIMIT 1 FOR UPDATE;

  IF _inv_id IS NULL THEN RAISE EXCEPTION 'no such crew'; END IF;

  IF _qty <= 1 THEN
    UPDATE public.inventory
       SET meta = jsonb_build_object(
         'assigned_ship_id', _ship_id::text,
         'assigned_at', _assigned_at,
         'expires_at', _expires
       )
     WHERE id = _inv_id;
    _new_id := _inv_id;
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _inv_id;
    INSERT INTO public.inventory(user_id, item_type, item_id, quantity, meta)
    VALUES (_uid,'crew',_crew_id,1,
      jsonb_build_object('assigned_ship_id', _ship_id::text,'assigned_at', _assigned_at,'expires_at', _expires))
    RETURNING id INTO _new_id;
  END IF;

  IF _crew_id = 'police' THEN
    FOR _raider IN
      SELECT id, user_id FROM public.ships_owned
      WHERE stealing_target_ship_id = _ship_id
        AND stealing_target_user_id = _uid
        AND stealing_ends_at IS NOT NULL AND stealing_ends_at > now()
      FOR UPDATE
    LOOP
      UPDATE public.profiles SET steal_blocked_until = now() + interval '1 hour'
       WHERE id = _raider.user_id;
      UPDATE public.ships_owned
         SET at_sea = false, fishing_started_at = NULL,
             stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
       WHERE id = _raider.id;
    END LOOP;
  END IF;

  inventory_id := _new_id;
  expires_at := _expires;
  RETURN NEXT;
END;
$function$;

-- 2) Improved activate_golden_fisher: extend by 24h if user has spare inventory, always refresh shield
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

  -- Try to consume one inventory regardless of already-active state, to allow extension/repair
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
    -- Extend from current expiry if still active, else from now
    _base := GREATEST(COALESCE(_current, now()), now());
    _new_until := _base + interval '24 hours';
  ELSE
    -- No inventory available
    IF _current IS NULL OR _current <= now() THEN
      RAISE EXCEPTION 'no_golden_fisher_in_inventory';
    END IF;
    -- Already active: keep current expiry but still refresh shield below
    _new_until := _current;
  END IF;

  UPDATE public.profiles
     SET golden_fisher_until = _new_until,
         golden_fisher_last_activated_at = now(),
         protection_until = GREATEST(COALESCE(protection_until, _new_until), _new_until)
   WHERE id = _uid;

  UPDATE public.ships_owned
     SET fishing_started_at = COALESCE(fishing_started_at, now()),
         at_sea = true
   WHERE user_id = _uid
     AND in_storage = false
     AND destroyed_at IS NULL
     AND (repair_ends_at IS NULL OR repair_ends_at <= now())
     AND stealing_target_user_id IS NULL
     AND stealing_ends_at IS NULL;

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
