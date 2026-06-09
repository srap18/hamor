
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
  _attacker_name text;
  _target_name text;
  _total_damage integer := 0;
  _bomb_dmg integer := 70000000;
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

  -- Apply 70M damage per ship (caps at max_hp; destroys if HP hits 0).
  WITH hit AS (
    UPDATE public.ships_owned
    SET hp = GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg),
        destroyed_at = CASE
          WHEN GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg) = 0 AND destroyed_at IS NULL
          THEN now() ELSE destroyed_at END,
        repair_ends_at = CASE
          WHEN GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg) = 0 AND repair_ends_at IS NULL
          THEN now() + interval '4 hours' ELSE repair_ends_at END,
        at_sea = CASE WHEN GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg) = 0 THEN false ELSE at_sea END,
        fishing_started_at = CASE WHEN GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg) = 0 THEN NULL ELSE fishing_started_at END,
        stealing_target_user_id = CASE WHEN GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg) = 0 THEN NULL ELSE stealing_target_user_id END,
        stealing_target_ship_id = CASE WHEN GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg) = 0 THEN NULL ELSE stealing_target_ship_id END,
        stealing_ends_at = CASE WHEN GREATEST(0, COALESCE(hp, max_hp) - _bomb_dmg) = 0 THEN NULL ELSE stealing_ends_at END
    WHERE user_id = _target_id AND in_storage = false
    RETURNING id, LEAST(_bomb_dmg, COALESCE(max_hp, _bomb_dmg)) AS dealt
  )
  SELECT count(*), COALESCE(SUM(dealt), 0) INTO _ships_hit, _total_damage FROM hit;

  INSERT INTO public.attacks (attacker_id, defender_id, damage, damage_dealt, attacker_won)
  VALUES (_attacker, _target_id, _bomb_dmg, COALESCE(_total_damage, 0), true);

  _xp_award := 250 * GREATEST(_ships_hit, 0);
  IF _xp_award > 0 THEN
    UPDATE public.profiles SET xp = COALESCE(xp,0) + _xp_award WHERE id = _attacker;
  END IF;

  INSERT INTO public.ad_bombs (target_user_id, attacker_id, video_key)
  VALUES (_target_id, _attacker, _video_key)
  RETURNING id INTO _new_id;

  SELECT display_name INTO _attacker_name FROM public.profiles WHERE id = _attacker;
  SELECT display_name INTO _target_name   FROM public.profiles WHERE id = _target_id;
  PERFORM public.stamp_global_last_attack(
    _attacker, COALESCE(_attacker_name, 'لاعب'),
    _target_id, COALESCE(_target_name, 'لاعب'),
    'ad_bomb'
  );

  RETURN _new_id;
END;
$function$;
