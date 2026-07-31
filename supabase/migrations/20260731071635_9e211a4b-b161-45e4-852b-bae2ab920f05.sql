-- ============================================================
-- STEAL SYSTEM — clean rebuild (server-side authoritative)
-- ============================================================

-- 1) Thief crew: +30% steal SPEED only, applied exactly once at mission start.
CREATE OR REPLACE FUNCTION public._steal_duration_seconds(_user uuid, _ship_id uuid, _cat ship_catalog, _started_at timestamp with time zone DEFAULT now())
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT GREATEST(
    1,
    CASE WHEN EXISTS (
      SELECT 1
      FROM public.inventory i
      WHERE i.user_id = _user
        AND i.item_type = 'crew'
        AND i.item_id = 'thief'
        AND i.quantity > 0
        AND i.meta->>'assigned_ship_id' = _ship_id::text
        AND COALESCE(NULLIF(i.meta->>'assigned_at', '')::timestamptz, _started_at) <= _started_at
        AND COALESCE(NULLIF(i.meta->>'expires_at', '')::timestamptz, _started_at + interval '100 years') > _started_at
    )
    -- +30% speed  =>  duration / 1.30
    THEN CEIL(public._steal_seconds_for(_cat) / 1.30)::integer
    ELSE public._steal_seconds_for(_cat)
    END
  );
$function$;

-- 2) Helper: police assigned to a SPECIFIC ship (not account-wide).
CREATE OR REPLACE FUNCTION public.ship_has_police(_owner uuid, _ship_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.inventory i
    WHERE i.user_id = _owner
      AND i.item_type = 'crew'
      AND i.item_id = 'police'
      AND i.quantity > 0
      AND i.meta->>'assigned_ship_id' = _ship_id::text
      AND COALESCE(NULLIF(i.meta->>'expires_at','')::timestamptz, now() + interval '100 years') > now()
  );
$function$;

-- 3) Helper: fish capacity of a ship (same rules as fishing) and current load.
CREATE OR REPLACE FUNCTION public._ship_fish_capacity(_ship_id uuid)
RETURNS bigint
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s public.ships_owned%ROWTYPE;
  _cat public.ship_catalog%ROWTYPE;
  _cap bigint;
  _hp_ratio numeric := 1;
BEGIN
  SELECT * INTO _s FROM public.ships_owned WHERE id = _ship_id;
  IF _s.id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO _cat FROM public.ship_catalog WHERE code = _s.catalog_code AND active = true LIMIT 1;
  IF _cat.id IS NULL THEN
    SELECT * INTO _cat FROM public.ship_catalog
     WHERE code = ('ship-lvl-' || COALESCE(_s.template_id, 1)) AND active = true LIMIT 1;
  END IF;

  IF COALESCE(_s.catalog_code,'') IN ('submarine','upgrade-sub') OR COALESCE(_s.template_id,0) IN (32,33) THEN
    _cap := COALESCE(_s.max_hp, _cat.storage, 10);
  ELSE
    _cap := COALESCE(_cat.storage, 10);
  END IF;

  IF COALESCE(_s.max_hp,0) > 0 THEN
    _hp_ratio := LEAST(1, GREATEST(0, _s.hp::numeric / _s.max_hp::numeric));
  END IF;

  RETURN GREATEST(0, FLOOR(_cap * _hp_ratio)::bigint);
END;
$function$;

CREATE OR REPLACE FUNCTION public._ship_fish_load(_owner uuid, _ship_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(GREATEST(0, quantity)), 0)::bigint
  FROM public.fish_stock
  WHERE user_id = _owner AND ship_id = _ship_id;
$function$;

-- 4) Core settlement: move REAL fish from target ship to thief ship.
DROP FUNCTION IF EXISTS public.claim_steal_mission(uuid, boolean);
DROP FUNCTION IF EXISTS public.cancel_steal_mission(uuid);

CREATE OR REPLACE FUNCTION public._settle_steal_mission(_attacker_ship_id uuid, _reason text)
RETURNS TABLE(stolen_count integer, total_value bigint, fish_summary jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _my public.ships_owned%ROWTYPE;
  _tgt public.ships_owned%ROWTYPE;
  _ratio numeric := 0;
  _dur numeric;
  _free bigint;
  _avail bigint;
  _market bigint;
  _allowed bigint;
  _remaining bigint;
  _moved bigint := 0;
  _value bigint := 0;
  _summary jsonb := '[]'::jsonb;
  r RECORD;
  _take bigint;
  _a bigint; _b bigint;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  -- Deterministic advisory lock ordering (prevents deadlocks between
  -- claim / cancel / catch racing on the same pair of ships).
  PERFORM pg_advisory_xact_lock(hashtextextended('steal_mission:' || _attacker_ship_id::text, 0));

  SELECT * INTO _my FROM public.ships_owned
   WHERE id = _attacker_ship_id AND user_id = _me FOR UPDATE;
  IF _my.id IS NULL THEN RAISE EXCEPTION 'no active steal mission'; END IF;
  IF _my.stealing_target_ship_id IS NULL OR _my.stealing_ends_at IS NULL OR _my.stealing_started_at IS NULL THEN
    RAISE EXCEPTION 'no active steal mission';
  END IF;

  -- Progress is pure wall-clock over the stored window (bonus already baked in).
  _dur := GREATEST(1, EXTRACT(EPOCH FROM (_my.stealing_ends_at - _my.stealing_started_at)));
  _ratio := LEAST(1, GREATEST(0, EXTRACT(EPOCH FROM (now() - _my.stealing_started_at)) / _dur));

  IF _reason = 'claim' AND _ratio < 1 THEN
    RAISE EXCEPTION 'mission not finished';
  END IF;

  SELECT * INTO _tgt FROM public.ships_owned
   WHERE id = _my.stealing_target_ship_id FOR UPDATE;

  -- Always end the mission exactly once, whatever the outcome.
  UPDATE public.ships_owned
     SET stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_started_at = NULL,
         stealing_ends_at = NULL,
         at_sea = false
   WHERE id = _attacker_ship_id;

  IF _tgt.id IS NULL THEN
    RETURN QUERY SELECT 0, 0::bigint, '[]'::jsonb; RETURN;
  END IF;

  _free   := GREATEST(0, public._ship_fish_capacity(_attacker_ship_id) - public._ship_fish_load(_me, _attacker_ship_id));
  _avail  := public._ship_fish_load(_tgt.user_id, _tgt.id);
  _market := public.user_market_remaining(_me);

  _a := LEAST(_free, _avail);
  _allowed := FLOOR(_a * _ratio)::bigint;
  _allowed := LEAST(_allowed, _free, _avail, _market);
  IF _allowed <= 0 THEN
    RETURN QUERY SELECT 0, 0::bigint, '[]'::jsonb; RETURN;
  END IF;

  _remaining := _allowed;

  FOR r IN
    SELECT id, fish_id, base_value, quantity
      FROM public.fish_stock
     WHERE user_id = _tgt.user_id AND ship_id = _tgt.id AND quantity > 0
     ORDER BY base_value DESC, caught_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN _remaining <= 0;
    _take := LEAST(_remaining, r.quantity);
    IF _take <= 0 THEN CONTINUE; END IF;

    IF _take >= r.quantity THEN
      UPDATE public.fish_stock
         SET user_id = _me, ship_id = _attacker_ship_id, caught_at = now()
       WHERE id = r.id;
    ELSE
      UPDATE public.fish_stock SET quantity = quantity - _take WHERE id = r.id;
      INSERT INTO public.fish_stock(user_id, fish_id, ship_id, caught_at, base_value, quantity)
      VALUES (_me, r.fish_id, _attacker_ship_id, now(), r.base_value, _take);
    END IF;

    _moved := _moved + _take;
    _value := _value + (_take * COALESCE(r.base_value, 0));
    _remaining := _remaining - _take;
    _summary := _summary || jsonb_build_array(
      jsonb_build_object('fish_id', r.fish_id, 'qty', _take, 'value', _take * COALESCE(r.base_value,0))
    );
  END LOOP;

  RETURN QUERY SELECT _moved::int, _value, _summary;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_steal_mission(_attacker_ship_id uuid, _force boolean DEFAULT false)
RETURNS TABLE(stolen_count integer, total_value bigint, fish_summary jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY SELECT * FROM public._settle_steal_mission(
    _attacker_ship_id,
    CASE WHEN COALESCE(_force,false) THEN 'manual_cancel' ELSE 'claim' END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_steal_mission(_attacker_ship_id uuid)
RETURNS TABLE(stolen_count integer, total_value bigint, fish_summary jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY SELECT * FROM public._settle_steal_mission(_attacker_ship_id, 'manual_cancel');
END;
$function$;

-- 5) Manual catch — target owner only, this raider ship only, zero loot,
--    account-wide 1 hour block, other raids untouched, HP untouched.
CREATE OR REPLACE FUNCTION public.catch_thief(_attacker_ship_id uuid)
RETURNS TABLE(blocked_until timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _ship public.ships_owned%ROWTYPE;
  _until timestamptz;
  _name text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('steal_mission:' || _attacker_ship_id::text, 0));

  SELECT * INTO _ship FROM public.ships_owned WHERE id = _attacker_ship_id FOR UPDATE;
  IF _ship.id IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _ship.stealing_target_user_id IS DISTINCT FROM _me THEN RAISE EXCEPTION 'not your target'; END IF;
  IF _ship.stealing_ends_at IS NULL THEN RAISE EXCEPTION 'no active steal mission'; END IF;

  _until := now() + interval '1 hour';

  UPDATE public.profiles
     SET steal_blocked_until = GREATEST(COALESCE(steal_blocked_until, now()), _until)
   WHERE id = _ship.user_id;

  -- Only THIS raider ship is stopped; the thief's other missions keep running.
  UPDATE public.ships_owned
     SET stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_started_at = NULL,
         stealing_ends_at = NULL,
         at_sea = false
   WHERE id = _attacker_ship_id;

  SELECT display_name INTO _name FROM public.profiles WHERE id = _me;
  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
  VALUES (
    _ship.user_id,
    '🚨 تم القبض على سفينتك!',
    'تم إيقاف السرقة بدون غنيمة، وممنوع عليك تنفيذ سرقات جديدة لمدة ساعة.',
    'attack',
    _me
  );

  RETURN QUERY SELECT _until;
END;
$function$;

-- 6) Start mission — police auto-protection + account-wide block check.
DROP FUNCTION IF EXISTS public.start_steal_mission(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.start_steal_mission(_attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid)
RETURNS TABLE(ends_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _blocked timestamptz;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT steal_blocked_until INTO _blocked FROM public.profiles WHERE id = _me;
  IF _blocked IS NOT NULL AND _blocked > now() THEN
    RAISE EXCEPTION 'blocked from stealing until %', _blocked;
  END IF;

  IF public.ship_has_police(_target_user_id, _target_ship_id) THEN
    RAISE EXCEPTION 'هذه السفينة محمية بواسطة الشرطي ولا يمكن سرقتها.';
  END IF;

  RETURN QUERY SELECT * FROM public.start_steal_mission_impl(_attacker_ship_id, _target_user_id, _target_ship_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.start_steal_mission(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_steal_mission(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_steal_mission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.catch_thief(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ship_has_police(uuid, uuid) TO authenticated;