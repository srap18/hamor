
-- 1) PvP threshold helper: a player is "PvP-ready" iff they own at least 3 ships of template_id >= 6
CREATE OR REPLACE FUNCTION public.has_pvp_fleet(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT COUNT(*) FROM public.ships_owned
      WHERE user_id = _user_id
        AND COALESCE(template_id, 0) >= 6), 0) >= 3
$$;

GRANT EXECUTE ON FUNCTION public.has_pvp_fleet(uuid) TO anon, authenticated, service_role;

-- 2) Gate apply_ship_damage: attacker must be PvP-ready; target with no PvP fleet is immune
CREATE OR REPLACE FUNCTION public.apply_ship_damage(_ship_id uuid, _damage integer)
 RETURNS TABLE(new_hp integer, destroyed boolean, repair_ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _owner uuid;
  _tpl int;
  _repair_secs int;
  _resulting_hp int;
  _resulting_repair timestamptz;
  _prot timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT s.user_id, s.template_id INTO _owner, _tpl
    FROM public.ships_owned s WHERE s.id = _ship_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _owner = auth.uid() THEN RAISE EXCEPTION 'cannot attack own ship'; END IF;

  -- New: PvP gating
  IF NOT public.has_pvp_fleet(auth.uid()) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;
  IF NOT public.has_pvp_fleet(_owner) THEN
    RAISE EXCEPTION 'target is protected (no pvp fleet)';
  END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _owner;
  IF _prot IS NOT NULL AND _prot > now() THEN
    RAISE EXCEPTION 'target is protected';
  END IF;

  _tpl := COALESCE(_tpl, 1);
  _repair_secs := LEAST(259200, GREATEST(14400, _tpl * _tpl * 600));

  UPDATE public.ships_owned AS s
     SET hp = s.max_hp, destroyed_at = NULL, repair_ends_at = NULL
   WHERE s.id = _ship_id
     AND s.destroyed_at IS NOT NULL
     AND s.repair_ends_at IS NOT NULL
     AND s.repair_ends_at <= now();

  UPDATE public.ships_owned AS s
    SET hp = GREATEST(0, COALESCE(s.hp, 100) - _damage),
        destroyed_at = CASE
          WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 AND s.destroyed_at IS NULL
          THEN now() ELSE s.destroyed_at END,
        repair_ends_at = CASE
          WHEN GREATEST(0, COALESCE(s.hp, 100) - _damage) = 0 AND s.repair_ends_at IS NULL
          THEN now() + make_interval(secs => _repair_secs) ELSE s.repair_ends_at END
  WHERE s.id = _ship_id
  RETURNING s.hp, s.repair_ends_at INTO _resulting_hp, _resulting_repair;

  new_hp := _resulting_hp;
  destroyed := _resulting_hp = 0;
  repair_ends_at := _resulting_repair;
  RETURN NEXT;
END;
$function$;

-- 3) Gate start_steal_mission with PvP threshold (keep prior protections)
CREATE OR REPLACE FUNCTION public.start_steal_mission(_attacker_ship_id uuid, _target_user_id uuid, _target_ship_id uuid)
 RETURNS TABLE(ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _my_ship public.ships_owned%ROWTYPE;
  _their_ship public.ships_owned%ROWTYPE;
  _prot timestamptz;
  _blk timestamptz;
  _secs integer;
  _ends timestamptz;
  _bypass boolean := false;
  _has_police boolean;
  _has_thief boolean;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _target_user_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;

  -- New: PvP gating
  IF NOT public.has_pvp_fleet(_me) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;
  IF NOT public.has_pvp_fleet(_target_user_id) THEN
    RAISE EXCEPTION 'target is protected (no pvp fleet)';
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
   WHERE id = _attacker_ship_id AND user_id = _me
     AND stealing_target_user_id IS NOT NULL
     AND stealing_ends_at IS NOT NULL
     AND stealing_ends_at <= now();

  SELECT steal_blocked_until INTO _blk FROM public.profiles WHERE id = _me;
  IF _blk IS NOT NULL AND _blk > now() THEN
    RAISE EXCEPTION 'thief blocked until %', _blk;
  END IF;

  SELECT * INTO _my_ship FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _me;
  IF NOT FOUND THEN RAISE EXCEPTION 'attacker ship not found'; END IF;
  IF _my_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'ship is destroyed'; END IF;
  IF _my_ship.at_sea THEN RAISE EXCEPTION 'ship is busy at sea'; END IF;
  IF _my_ship.repair_ends_at IS NOT NULL AND _my_ship.repair_ends_at > now() THEN
    RAISE EXCEPTION 'ship under repair';
  END IF;

  SELECT * INTO _their_ship FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _target_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'target ship not found'; END IF;
  IF _their_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'target ship destroyed'; END IF;
  IF NOT _their_ship.at_sea OR _their_ship.fishing_started_at IS NULL
     OR _their_ship.stealing_target_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'target not fishing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE stealing_target_ship_id = _target_ship_id
       AND stealing_ends_at IS NOT NULL
       AND stealing_ends_at > now()
  ) THEN
    RAISE EXCEPTION 'target ship already being raided';
  END IF;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_user_id;
  IF _prot IS NOT NULL AND _prot > now() THEN
    RAISE EXCEPTION 'target is protected';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.inventory
     WHERE user_id = _target_user_id
       AND item_type = 'crew' AND item_id = 'police' AND quantity > 0
       AND meta ? 'assigned_ship_id'
       AND (meta->>'expires_at' IS NULL OR (meta->>'expires_at')::timestamptz > now())
  ) INTO _has_police;

  IF _has_police THEN
    SELECT EXISTS (
      SELECT 1 FROM public.inventory
       WHERE user_id = _me
         AND item_type = 'crew' AND item_id = 'thief' AND quantity > 0
         AND meta ? 'assigned_ship_id'
         AND (meta->>'expires_at' IS NULL OR (meta->>'expires_at')::timestamptz > now())
    ) INTO _has_thief;

    IF _has_thief THEN
      _bypass := (random() < 0.8);
    END IF;

    IF NOT _bypass THEN
      UPDATE public.profiles SET steal_blocked_until = now() + interval '1 hour' WHERE id = _me;
      INSERT INTO public.notifications (recipient_id, title, body, kind)
      VALUES
        (_me, '👮 قبض عليك!', 'شرطي الخصم قبض عليك — ممنوع من السرقة ساعة', 'warning'),
        (_target_user_id, '👮 شرطيك قبض على لص!', 'شرطيك أمسك لصاً يحاول سرقتك', 'success');
      RAISE EXCEPTION 'caught by police';
    END IF;
  END IF;

  SELECT COALESCE(sc.fishing_seconds, 30) INTO _secs
  FROM public.ship_catalog sc WHERE sc.code = _my_ship.catalog_code;
  IF _secs IS NULL OR _secs < 5 THEN _secs := 30; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.inventory
     WHERE user_id = _me
       AND item_type = 'crew' AND item_id = 'thief' AND quantity > 0
       AND meta ? 'assigned_ship_id'
       AND (meta->>'expires_at' IS NULL OR (meta->>'expires_at')::timestamptz > now())
  ) INTO _has_thief;
  IF _has_thief THEN
    _secs := GREATEST(5, (_secs * 6 / 10));
  END IF;

  _ends := now() + make_interval(secs => _secs);

  UPDATE public.ships_owned
     SET at_sea = true,
         fishing_started_at = now(),
         stealing_target_user_id = _target_user_id,
         stealing_target_ship_id = _target_ship_id,
         stealing_ends_at = _ends
   WHERE id = _attacker_ship_id;

  RETURN QUERY SELECT _ends;
END;
$function$;

-- 4) Improve claim_steal_mission: fall back to ANY fish in target stock if pool yields none,
--    so a successful raid always returns fish whenever the target has any in storage.
CREATE OR REPLACE FUNCTION public.claim_steal_mission(_attacker_ship_id uuid)
 RETURNS TABLE(stolen_count integer, total_value bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _my_ship public.ships_owned%ROWTYPE;
  _pool jsonb;
  _max integer;
  _moved integer := 0;
  _value bigint := 0;
  _prot timestamptz;
  _target_ship_id uuid;
  _target_user_id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _my_ship FROM public.ships_owned
   WHERE id = _attacker_ship_id AND user_id = _me FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _my_ship.stealing_target_user_id IS NULL THEN
    RAISE EXCEPTION 'no active steal mission';
  END IF;
  IF _my_ship.stealing_ends_at IS NULL OR _my_ship.stealing_ends_at > now() THEN
    RAISE EXCEPTION 'mission not finished';
  END IF;

  _target_ship_id := _my_ship.stealing_target_ship_id;
  _target_user_id := _my_ship.stealing_target_user_id;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_user_id;
  IF _prot IS NOT NULL AND _prot > now() THEN
    UPDATE public.ships_owned
       SET at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
     WHERE id = _attacker_ship_id;
    UPDATE public.ships_owned
       SET at_sea = false, fishing_started_at = NULL
     WHERE id = _target_ship_id AND user_id = _target_user_id;
    RETURN QUERY SELECT 0, 0::bigint;
    RETURN;
  END IF;

  SELECT sc.fish_pool INTO _pool
  FROM public.ships_owned so
  JOIN public.ship_catalog sc ON sc.code = so.catalog_code
  WHERE so.id = _target_ship_id AND so.user_id = _target_user_id;
  IF _pool IS NULL THEN _pool := '[]'::jsonb; END IF;

  SELECT COALESCE(sc.fishing_power, 5) INTO _max
  FROM public.ship_catalog sc WHERE sc.code = _my_ship.catalog_code;
  IF _max IS NULL OR _max < 1 THEN _max := 5; END IF;
  IF _max > 100 THEN _max := 100; END IF;

  -- Try fish from the target ship's pool first
  WITH pool_ids AS (
    SELECT jsonb_array_elements_text(_pool) AS fid
  ),
  picked AS (
    SELECT fs.id, fs.base_value
      FROM public.fish_stock fs
     WHERE fs.user_id = _target_user_id
       AND fs.fish_id IN (SELECT fid FROM pool_ids)
     ORDER BY fs.base_value DESC, fs.caught_at ASC
     LIMIT _max
     FOR UPDATE SKIP LOCKED
  ),
  moved AS (
    UPDATE public.fish_stock fs
       SET user_id = _me, caught_at = now(), ship_id = _attacker_ship_id
      FROM picked
     WHERE fs.id = picked.id
    RETURNING picked.base_value AS v
  )
  SELECT COUNT(*)::int, COALESCE(SUM(v),0)::bigint INTO _moved, _value FROM moved;

  -- Fallback: if pool yielded nothing, grab ANY fish from the target's stock
  IF _moved = 0 THEN
    WITH picked AS (
      SELECT fs.id, fs.base_value
        FROM public.fish_stock fs
       WHERE fs.user_id = _target_user_id
       ORDER BY fs.base_value DESC, fs.caught_at ASC
       LIMIT _max
       FOR UPDATE SKIP LOCKED
    ),
    moved AS (
      UPDATE public.fish_stock fs
         SET user_id = _me, caught_at = now(), ship_id = _attacker_ship_id
        FROM picked
       WHERE fs.id = picked.id
      RETURNING picked.base_value AS v
    )
    SELECT COUNT(*)::int, COALESCE(SUM(v),0)::bigint INTO _moved, _value FROM moved;
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false,
         fishing_started_at = NULL,
         stealing_target_user_id = NULL,
         stealing_target_ship_id = NULL,
         stealing_ends_at = NULL
   WHERE id = _attacker_ship_id;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL
   WHERE id = _target_ship_id AND user_id = _target_user_id;

  RETURN QUERY SELECT _moved, _value;
END;
$function$;

-- 5) Same fallback for cancel_steal_mission (early recall by attacker)
CREATE OR REPLACE FUNCTION public.cancel_steal_mission(_attacker_ship_id uuid)
 RETURNS TABLE(stolen_count integer, total_value bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _ship public.ships_owned%ROWTYPE;
  _pool jsonb;
  _max integer;
  _scaled integer;
  _moved integer := 0;
  _value bigint := 0;
  _prot timestamptz;
  _ratio numeric := 0;
  _duration numeric;
  _elapsed numeric;
  _target_ship_id uuid;
  _target_user_id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT * INTO _ship FROM public.ships_owned WHERE id = _attacker_ship_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ship not found'; END IF;
  IF _ship.stealing_target_user_id IS NULL THEN
    RAISE EXCEPTION 'no active steal mission';
  END IF;
  IF _ship.user_id <> _me AND _ship.stealing_target_user_id <> _me THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  _target_ship_id := _ship.stealing_target_ship_id;
  _target_user_id := _ship.stealing_target_user_id;

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_user_id;
  IF _prot IS NOT NULL AND _prot > now() THEN
    UPDATE public.ships_owned
       SET at_sea = false, fishing_started_at = NULL,
           stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
     WHERE id = _attacker_ship_id;
    UPDATE public.ships_owned
       SET at_sea = false, fishing_started_at = NULL
     WHERE id = _target_ship_id AND user_id = _target_user_id;
    RETURN QUERY SELECT 0, 0::bigint;
    RETURN;
  END IF;

  IF _ship.fishing_started_at IS NULL OR _ship.stealing_ends_at IS NULL THEN
    _ratio := 0;
  ELSE
    _duration := GREATEST(1, EXTRACT(EPOCH FROM (_ship.stealing_ends_at - _ship.fishing_started_at)));
    _elapsed := GREATEST(0, EXTRACT(EPOCH FROM (LEAST(now(), _ship.stealing_ends_at) - _ship.fishing_started_at)));
    _ratio := LEAST(1, _elapsed / _duration);
  END IF;

  SELECT COALESCE(sc.fishing_power, 5) INTO _max
  FROM public.ship_catalog sc WHERE sc.code = _ship.catalog_code;
  IF _max IS NULL OR _max < 1 THEN _max := 5; END IF;
  IF _max > 100 THEN _max := 100; END IF;

  IF _ship.user_id = _me THEN
    _scaled := GREATEST(1, FLOOR(_max * _ratio)::int);
  ELSE
    _scaled := 0;
  END IF;

  IF _scaled > 0 THEN
    SELECT sc.fish_pool INTO _pool
    FROM public.ships_owned so
    JOIN public.ship_catalog sc ON sc.code = so.catalog_code
    WHERE so.id = _target_ship_id AND so.user_id = _target_user_id;
    IF _pool IS NULL THEN _pool := '[]'::jsonb; END IF;

    WITH pool_ids AS (
      SELECT jsonb_array_elements_text(_pool) AS fid
    ),
    picked AS (
      SELECT fs.id, fs.base_value
        FROM public.fish_stock fs
       WHERE fs.user_id = _target_user_id
         AND fs.fish_id IN (SELECT fid FROM pool_ids)
       ORDER BY fs.base_value DESC, fs.caught_at ASC
       LIMIT _scaled
       FOR UPDATE SKIP LOCKED
    ),
    moved AS (
      UPDATE public.fish_stock fs
         SET user_id = _ship.user_id, caught_at = now(), ship_id = _attacker_ship_id
        FROM picked
       WHERE fs.id = picked.id
      RETURNING picked.base_value AS v
    )
    SELECT COUNT(*)::int, COALESCE(SUM(v),0)::bigint INTO _moved, _value FROM moved;

    -- Fallback: any fish if the pool match found nothing
    IF _moved = 0 THEN
      WITH picked AS (
        SELECT fs.id, fs.base_value
          FROM public.fish_stock fs
         WHERE fs.user_id = _target_user_id
         ORDER BY fs.base_value DESC, fs.caught_at ASC
         LIMIT _scaled
         FOR UPDATE SKIP LOCKED
      ),
      moved AS (
        UPDATE public.fish_stock fs
           SET user_id = _ship.user_id, caught_at = now(), ship_id = _attacker_ship_id
          FROM picked
         WHERE fs.id = picked.id
        RETURNING picked.base_value AS v
      )
      SELECT COUNT(*)::int, COALESCE(SUM(v),0)::bigint INTO _moved, _value FROM moved;
    END IF;
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
   WHERE id = _attacker_ship_id;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL
   WHERE id = _target_ship_id AND user_id = _target_user_id;

  RETURN QUERY SELECT _moved, _value;
END;
$function$;
