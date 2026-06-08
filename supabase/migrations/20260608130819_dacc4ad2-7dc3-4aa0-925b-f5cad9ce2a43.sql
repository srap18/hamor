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
  _prot timestamptz;
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF _video_key IS NULL OR length(_video_key) = 0 THEN RAISE EXCEPTION 'video required'; END IF;
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

  INSERT INTO public.ad_bombs (target_user_id, attacker_id, video_key)
  VALUES (_target_id, _attacker, _video_key)
  RETURNING id INTO _new_id;

  RETURN _new_id;
END;
$function$;