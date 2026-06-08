
-- 1) Block ad-bomb attacks on staff accounts
CREATE OR REPLACE FUNCTION public.launch_ad_bomb(_target_id uuid, _video_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _attacker uuid := auth.uid();
  _new_id uuid;
  _ships_hit integer := 0;
  _qty integer;
  _xp_award integer;
  _attacker_name text;
  _target_name text;
  _prot timestamptz;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF _video_key IS NULL OR length(_video_key) = 0 THEN RAISE EXCEPTION 'video required'; END IF;
  -- Staff accounts are off-limits to all attacks.
  IF public.is_admin(_target_id) THEN
    RAISE EXCEPTION 'target is a staff account (protected)';
  END IF;

  IF NOT public.is_market_pvp_unlocked(_attacker) THEN
    RAISE EXCEPTION 'attacker market level under 6';
  END IF;
  IF NOT public.has_pvp_fleet(_attacker) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ships_owned
     WHERE user_id = _attacker AND in_storage = false AND destroyed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'attacker has destroyed ship';
  END IF;
  IF NOT public.has_fishing_ship(_attacker) THEN
    RAISE EXCEPTION 'attacker needs fishing ship: send a ship to fish first';
  END IF;
  IF NOT public.is_market_pvp_unlocked(_target_id) THEN
    RAISE EXCEPTION 'target is protected (market level under 6)';
  END IF;
  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_id FOR UPDATE;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = _attacker AND protection_until IS NOT NULL AND protection_until > now();

  SELECT quantity INTO _qty FROM public.inventory
  WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon' FOR UPDATE;
  IF _qty IS NULL OR _qty < 1 THEN RAISE EXCEPTION 'no ad_bomb in inventory'; END IF;
  IF _qty = 1 THEN
    DELETE FROM public.inventory WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
    WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  END IF;

  WITH hit AS (
    UPDATE public.ships_owned
    SET hp = 0,
        destroyed_at = COALESCE(destroyed_at, now()),
        repair_ends_at = now() + interval '4 hours',
        at_sea = false, fishing_started_at = NULL,
        stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
    WHERE user_id = _target_id AND in_storage = false
    RETURNING id, max_hp
  )
  SELECT count(*), COALESCE(SUM(max_hp), 0) INTO _ships_hit, _qty FROM hit;

  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won)
  VALUES (_attacker, _target_id, 999999, COALESCE(_qty, 0), true);

  _xp_award := 250 * GREATEST(_ships_hit, 0);
  IF _xp_award > 0 THEN
    UPDATE public.profiles SET xp = COALESCE(xp,0) + _xp_award WHERE id = _attacker;
  END IF;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name FROM public.profiles WHERE id = _target_id;

  INSERT INTO public.ad_bombs (target_id, attacker_id, video_key, attacker_name, target_name, ships_hit)
  VALUES (_target_id, _attacker, _video_key, _attacker_name, _target_name, _ships_hit)
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$function$;


-- 2) Block steal missions on staff accounts (early-exit guard;
--    rest of original function body left untouched via reuse).
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
  _cat public.ship_catalog%ROWTYPE;
  _blk timestamptz;
  _secs integer;
  _ends timestamptz;
  _bypass boolean := false;
  _has_police boolean;
  _has_thief boolean;
  _started timestamptz := now();
  _attacker_name text;
  _attacker_emoji text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _me = _target_user_id THEN RAISE EXCEPTION 'cannot steal from self'; END IF;
  -- Staff accounts are off-limits to all attacks.
  IF public.is_admin(_target_user_id) THEN
    RAISE EXCEPTION 'target is a staff account (protected)';
  END IF;

  IF NOT public.is_market_pvp_unlocked(_me) THEN
    RAISE EXCEPTION 'attacker market level under 6';
  END IF;

  IF NOT public.has_pvp_fleet(_me) THEN
    RAISE EXCEPTION 'attacker needs pvp fleet: 3 ships of level 6 or higher';
  END IF;
  IF NOT public.is_market_pvp_unlocked(_target_user_id) THEN
    RAISE EXCEPTION 'target is protected (market level under 6)';
  END IF;

  UPDATE public.ships_owned
     SET at_sea = false, fishing_started_at = NULL,
         stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
   WHERE user_id = _me AND id <> _attacker_ship_id;

  SELECT * INTO _my_ship FROM public.ships_owned WHERE id = _attacker_ship_id AND user_id = _me FOR UPDATE;
  IF _my_ship IS NULL THEN RAISE EXCEPTION 'attacker ship not found'; END IF;
  IF _my_ship.in_storage THEN RAISE EXCEPTION 'attacker ship in storage'; END IF;
  IF _my_ship.destroyed_at IS NOT NULL THEN RAISE EXCEPTION 'attacker ship destroyed'; END IF;
  IF _my_ship.at_sea THEN RAISE EXCEPTION 'attacker ship busy'; END IF;
  IF _my_ship.stealing_ends_at IS NOT NULL AND _my_ship.stealing_ends_at > now() THEN
    RAISE EXCEPTION 'attacker ship already stealing';
  END IF;

  SELECT * INTO _their_ship FROM public.ships_owned WHERE id = _target_ship_id AND user_id = _target_user_id FOR UPDATE;
  IF _their_ship IS NULL THEN RAISE EXCEPTION 'target ship not found'; END IF;
  IF NOT _their_ship.at_sea OR _their_ship.fishing_started_at IS NULL THEN
    RAISE EXCEPTION 'target ship not fishing';
  END IF;

  SELECT * INTO _cat FROM public.ship_catalog WHERE level = _my_ship.level;
  _secs := COALESCE(_cat.duration_seconds, 60);
  _ends := now() + (_secs || ' seconds')::interval;

  SELECT block_until INTO _blk FROM public.attacks_block_same_device(_me, _target_user_id) AS x(block_until timestamptz);
  IF _blk IS NOT NULL AND _blk > now() THEN
    RAISE EXCEPTION 'blocked by anti-cheat until %', _blk;
  END IF;

  UPDATE public.ships_owned
     SET stealing_target_user_id = _target_user_id,
         stealing_target_ship_id = _target_ship_id,
         stealing_ends_at = _ends,
         stealing_started_at = _started
   WHERE id = _my_ship.id;

  SELECT display_name, avatar_emoji INTO _attacker_name, _attacker_emoji
  FROM public.profiles WHERE id = _me;

  PERFORM public.notify_steal_started(_target_user_id, _me, _attacker_name, _attacker_emoji);

  RETURN QUERY SELECT _ends;
END;
$function$;


-- 3) Hide staff from competition leaderboards
CREATE OR REPLACE FUNCTION public.get_competition_leaderboard(_competition_id uuid)
 RETURNS TABLE(user_id uuid, display_name text, avatar_emoji text, avatar_url text, level integer, score bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c RECORD;
BEGIN
  SELECT * INTO c FROM public.competitions WHERE id = _competition_id;
  IF c IS NULL THEN
    RETURN;
  END IF;

  IF c.metric = 'explode_count' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COUNT(*)::bigint AS score
    FROM public.attacks a
    JOIN public.profiles p ON p.id = a.attacker_id
    WHERE a.created_at >= c.starts_at AND a.created_at <= c.ends_at
      AND a.damage_dealt > 0
      AND NOT public.is_admin(p.id)
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 100;

  ELSIF c.metric = 'explode_damage' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(a.damage_dealt),0)::bigint AS score
    FROM public.attacks a
    JOIN public.profiles p ON p.id = a.attacker_id
    WHERE a.created_at >= c.starts_at AND a.created_at <= c.ends_at
      AND NOT public.is_admin(p.id)
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 100;

  ELSIF c.metric = 'fish_total' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(cc.qty),0)::bigint AS score
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
      AND NOT public.is_admin(p.id)
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 100;

  ELSIF c.metric = 'fish_specific' THEN
    RETURN QUERY
    SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level,
           COALESCE(SUM(cc.qty),0)::bigint AS score
    FROM public.competition_catches cc
    JOIN public.profiles p ON p.id = cc.user_id
    WHERE cc.caught_at >= c.starts_at AND cc.caught_at <= c.ends_at
      AND cc.fish_id = c.target_fish_id
      AND NOT public.is_admin(p.id)
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 100;
  END IF;
END;
$function$;


-- 4) Hide staff from weekly XP leaderboard
CREATE OR REPLACE FUNCTION public.get_weekly_xp_leaderboard(_limit integer DEFAULT 100)
 RETURNS TABLE(user_id uuid, display_name text, avatar_emoji text, avatar_url text, level integer, weekly_xp integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id,
         COALESCE(display_name, username, '—') AS display_name,
         avatar_emoji,
         avatar_url,
         level,
         weekly_xp
    FROM public.profiles p
   WHERE weekly_xp > 0
     AND NOT public.is_admin(p.id)
   ORDER BY weekly_xp DESC, level DESC
   LIMIT GREATEST(COALESCE(_limit, 100), 1)
$function$;


-- 5) Hide staff from tribe effort leaderboard
--    (the tribe scores sum across members, so we just exclude staff
--     members from the aggregations and from member counts).
CREATE OR REPLACE FUNCTION public.get_tribe_effort_leaderboard(_limit integer DEFAULT 100)
 RETURNS TABLE(tribe_id uuid, name text, emblem text, banner text, level integer, members integer, donation_score bigint, support_score bigint, attack_score bigint, power bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH member_counts AS (
    SELECT p.tribe_id, COUNT(*)::integer AS members
    FROM public.profiles p
    WHERE p.tribe_id IS NOT NULL
      AND NOT public.is_admin(p.id)
    GROUP BY p.tribe_id
  ),
  donations AS (
    SELECT p.tribe_id, COALESCE(SUM(td.amount),0)::bigint AS s
    FROM public.tribe_donations td
    JOIN public.profiles p ON p.id = td.user_id
    WHERE p.tribe_id IS NOT NULL AND NOT public.is_admin(p.id)
    GROUP BY p.tribe_id
  ),
  attacks_agg AS (
    SELECT p.tribe_id, COALESCE(SUM(a.damage_dealt),0)::bigint AS s
    FROM public.attacks a
    JOIN public.profiles p ON p.id = a.attacker_id
    WHERE p.tribe_id IS NOT NULL AND NOT public.is_admin(p.id)
    GROUP BY p.tribe_id
  )
  SELECT t.id, t.name, t.emblem, t.banner, t.level,
         COALESCE(mc.members, 0),
         COALESCE(d.s, 0),
         0::bigint AS support_score,
         COALESCE(aa.s, 0),
         (COALESCE(d.s,0) + COALESCE(aa.s,0))::bigint AS power
  FROM public.tribes t
  LEFT JOIN member_counts mc ON mc.tribe_id = t.id
  LEFT JOIN donations d ON d.tribe_id = t.id
  LEFT JOIN attacks_agg aa ON aa.tribe_id = t.id
  WHERE COALESCE(mc.members, 0) > 0
  ORDER BY power DESC, COALESCE(mc.members,0) DESC, t.name ASC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 200));
END;
$function$;
