
-- 1) Fix currency leaderboard: column types were swapped (coins is bigint, gems is integer)
DROP FUNCTION IF EXISTS public.get_currency_leaderboard(text, integer);

CREATE OR REPLACE FUNCTION public.get_currency_leaderboard(_col text, _limit integer DEFAULT 30)
RETURNS TABLE(
  id uuid, display_name text, avatar_emoji text, avatar_url text,
  level integer, xp integer, coins bigint, gems integer,
  name_frame text, avatar_frame text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _col NOT IN ('coins','gems','xp') THEN
    RAISE EXCEPTION 'invalid column';
  END IF;
  RETURN QUERY EXECUTE format(
    'SELECT p.id, p.display_name, p.avatar_emoji, p.avatar_url, p.level, p.xp, p.coins, p.gems, p.name_frame, p.avatar_frame
     FROM public.profiles p
     WHERE NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role IN (''admin''::app_role,''moderator''::app_role))
     ORDER BY p.%I DESC NULLS LAST LIMIT $1', _col
  ) USING _limit;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_currency_leaderboard(text, integer) TO anon, authenticated, service_role;

-- 2) record_attack: accept optional XP gain for the attacker (capped)
CREATE OR REPLACE FUNCTION public.record_attack(
  _defender_id uuid,
  _target_ship_id uuid,
  _damage integer,
  _damage_dealt integer,
  _attacker_won boolean,
  _xp_gain integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _id uuid; _xp int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;
  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;
  -- Cap XP gain to prevent abuse (max 2000 per attack)
  _xp := GREATEST(0, LEAST(COALESCE(_xp_gain, 0), 2000));
  IF _xp > 0 THEN
    PERFORM public._mutate_currency(_uid, 0, 0, 0, _xp);
  END IF;
  RETURN _id;
END $function$;

-- 3) launch_ad_bomb: also award XP to attacker based on ships destroyed (capped)
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
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF _video_key IS NULL OR length(_video_key) = 0 THEN RAISE EXCEPTION 'video required'; END IF;

  SELECT quantity INTO _qty
  FROM public.inventory
  WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon'
  FOR UPDATE;

  IF _qty IS NULL OR _qty < 1 THEN
    RAISE EXCEPTION 'no ad_bomb in inventory';
  END IF;

  IF _qty = 1 THEN
    DELETE FROM public.inventory
    WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  ELSE
    UPDATE public.inventory SET quantity = quantity - 1
    WHERE user_id = _attacker AND item_id = 'ad_bomb' AND item_type = 'weapon';
  END IF;

  WITH hit AS (
    UPDATE public.ships_owned
    SET
      hp = 0,
      destroyed_at = now(),
      repair_ends_at = now() + interval '6 hours',
      at_sea = false,
      fishing_started_at = NULL,
      stealing_target_user_id = NULL,
      stealing_target_ship_id = NULL,
      stealing_ends_at = NULL
    WHERE user_id = _target_id AND destroyed_at IS NULL
    RETURNING id, max_hp
  )
  SELECT count(*), COALESCE(SUM(max_hp), 0) INTO _ships_hit, _qty FROM hit;

  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won)
  VALUES (_attacker, _target_id, 999999, COALESCE(_qty, 0), true);

  INSERT INTO public.ad_bombs (target_user_id, attacker_id, video_key)
  VALUES (_target_id, _attacker, _video_key)
  RETURNING id INTO _new_id;

  INSERT INTO public.notifications (recipient_id, title, body, kind, created_by)
  VALUES (
    _target_id,
    '📺💥 قنبلة إعلانية!',
    'تم تفجير قنبلة إعلانية على محيطك! دُمّرت ' || _ships_hit || ' سفينة ووقت الإصلاح 6 ساعات',
    'attack',
    _attacker
  );

  -- Award XP to attacker: 250 per ship destroyed, capped at 2000
  _xp_award := LEAST(2000, 250 * GREATEST(1, _ships_hit));
  PERFORM public._mutate_currency(_attacker, 0, 0, 0, _xp_award);

  RETURN _new_id;
END $function$;
