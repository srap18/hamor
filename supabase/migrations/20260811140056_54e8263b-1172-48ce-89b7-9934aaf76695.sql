-- 1) Trigger: only strip Golden Fisher when the player actually LOSES VIP6,
--    and never strip a manual 24h activation.
CREATE OR REPLACE FUNCTION public.sync_elite_vip6_golden_fisher()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owned timestamptz;
  v_manual timestamptz;
  v_was_vip6 boolean := false;
BEGIN
  IF COALESCE(NEW.elite_vip_level, 0) >= 6
     AND (NEW.elite_vip_expires_at IS NULL OR NEW.elite_vip_expires_at > now()) THEN
    NEW.golden_fisher_until := GREATEST(
      COALESCE(NEW.golden_fisher_until, '-infinity'::timestamptz),
      COALESCE(NEW.elite_vip_expires_at, 'infinity'::timestamptz)
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_was_vip6 := COALESCE(OLD.elite_vip_level, 0) >= 6
                  AND (OLD.elite_vip_expires_at IS NULL OR OLD.elite_vip_expires_at > now());
  END IF;

  -- Not VIP6 now: only reset when the player just lost VIP6.
  -- Ordinary profile updates must never touch golden_fisher_until.
  IF TG_OP = 'UPDATE' AND NOT v_was_vip6 THEN
    RETURN NEW;
  END IF;

  SELECT MAX(NULLIF(i.meta->>'expires_at','')::timestamptz)
    INTO v_owned
    FROM public.inventory i
   WHERE i.user_id = NEW.id
     AND i.item_type = 'crew'
     AND i.item_id = 'golden_fisher'
     AND i.meta ? 'expires_at';

  v_manual := CASE
    WHEN NEW.golden_fisher_last_activated_at IS NOT NULL
     AND NEW.golden_fisher_last_activated_at + interval '24 hours' > now()
    THEN NEW.golden_fisher_last_activated_at + interval '24 hours'
  END;

  NEW.golden_fisher_until := NULLIF(
    GREATEST(COALESCE(v_owned, '-infinity'::timestamptz), COALESCE(v_manual, '-infinity'::timestamptz)),
    '-infinity'::timestamptz
  );
  RETURN NEW;
END;
$$;

-- 2) Sweep: same protection for the periodic safety net.
CREATE OR REPLACE FUNCTION public.sweep_expired_elite_vip()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH updated AS (
    UPDATE public.profiles
       SET elite_vip_level = 0,
           elite_vip_expires_at = NULL
     WHERE elite_vip_level > 0
       AND elite_vip_expires_at IS NOT NULL
       AND elite_vip_expires_at <= now()
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM updated;

  UPDATE public.profiles p
     SET golden_fisher_until = (
           SELECT MAX(NULLIF(i.meta->>'expires_at','')::timestamptz)
             FROM public.inventory i
            WHERE i.user_id = p.id
              AND i.item_type = 'crew'
              AND i.item_id = 'golden_fisher'
              AND i.meta ? 'expires_at'
         )
   WHERE p.golden_fisher_until IS NOT NULL
     AND NOT public.elite_vip6_active(p.id)
     -- keep manual 24h activations intact
     AND NOT (p.golden_fisher_last_activated_at IS NOT NULL
              AND p.golden_fisher_last_activated_at + interval '24 hours' > now())
     AND NOT EXISTS (
       SELECT 1 FROM public.inventory i
        WHERE i.user_id = p.id
          AND i.item_type = 'crew'
          AND i.item_id = 'golden_fisher'
          AND i.meta ? 'expires_at'
          AND NULLIF(i.meta->>'expires_at','')::timestamptz >= p.golden_fisher_until
     );

  RETURN v_count;
END;
$$;

-- 3) Activation: cap pre-activation backlog to a single fishing cycle so the
--    first tick cannot dump the whole market capacity at once.
CREATE OR REPLACE FUNCTION public.activate_golden_fisher()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row record; _current timestamptz; _new_until timestamptz;
  _had_inventory boolean := false; _tick jsonb; _is_admin boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM public._require_market_level(10);

  SELECT public.has_role(_uid, 'admin'::public.app_role) INTO _is_admin;
  _is_admin := COALESCE(_is_admin, false);

  SELECT golden_fisher_until INTO _current FROM public.profiles WHERE id = _uid FOR UPDATE;

  IF _current IS NOT NULL AND _current > now() AND NOT _is_admin THEN
    RAISE EXCEPTION 'golden_fisher_already_active';
  END IF;

  SELECT * INTO _row FROM public.inventory
   WHERE user_id = _uid AND item_type = 'crew' AND item_id = 'golden_fisher'
     AND (meta IS NULL OR (meta->>'assigned_ship_id') IS NULL) AND quantity > 0
   ORDER BY acquired_at ASC FOR UPDATE LIMIT 1;

  IF _row.id IS NOT NULL THEN
    _had_inventory := true;
    IF _row.quantity <= 1 THEN DELETE FROM public.inventory WHERE id = _row.id;
    ELSE UPDATE public.inventory SET quantity = quantity - 1 WHERE id = _row.id; END IF;
    _new_until := now() + interval '24 hours';
  ELSE
    IF _is_admin THEN
      _new_until := GREATEST(COALESCE(_current, now()), now()) + interval '24 hours';
    ELSE
      RAISE EXCEPTION 'no_golden_fisher_in_inventory';
    END IF;
  END IF;

  UPDATE public.profiles
     SET golden_fisher_until = _new_until,
         golden_fisher_last_activated_at = now(),
         golden_fisher_paused = false,
         golden_fisher_no_shield = true
   WHERE id = _uid;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL,
         stealing_ends_at = NULL, stealing_started_at = NULL
   WHERE stealing_target_user_id = _uid;

  -- Keep any already-sailing fishing trip alive, but clamp the backlog to at
  -- most one full fishing cycle: ships that were left at sea for hours must not
  -- convert into dozens of instant cycles when Golden Fisher starts.
  UPDATE public.ships_owned s
     SET at_sea = true,
         fishing_started_at = CASE
           WHEN COALESCE(s.at_sea, false) AND s.fishing_started_at IS NOT NULL
             THEN GREATEST(s.fishing_started_at,
                           now() - make_interval(secs => GREATEST(30, COALESCE(c.fishing_seconds, 600))::double precision))
           ELSE now()
         END,
         last_fishing_reward_at = CASE
           WHEN COALESCE(s.at_sea, false) AND s.fishing_started_at IS NOT NULL
             THEN GREATEST(COALESCE(s.last_fishing_reward_at, s.fishing_started_at),
                           now() - make_interval(secs => GREATEST(30, COALESCE(c.fishing_seconds, 600))::double precision))
           ELSE now()
         END
    FROM public.ship_catalog c
   WHERE c.code = COALESCE(NULLIF(s.catalog_code, ''), 'ship-lvl-' || COALESCE(s.template_id, 1)::text)
     AND c.active = true
     AND s.user_id = _uid AND s.in_storage = false AND s.destroyed_at IS NULL
     AND (s.repair_ends_at IS NULL OR s.repair_ends_at <= now())
     AND s.stealing_target_user_id IS NULL AND s.stealing_ends_at IS NULL;

  _tick := public.golden_fisher_tick(_uid);

  RETURN jsonb_build_object(
    'ok', true,
    'already_active', false,
    'extended', false,
    'admin_test', (_is_admin AND NOT _had_inventory),
    'until', _new_until,
    'tick', _tick
  );
END;
$$;
