-- When a shielded player attacks, drop their shield (can't shoot from behind shield)
-- Also block attacks targeting protected players in record_attack (ad_bomb already blocks)

CREATE OR REPLACE FUNCTION public.record_attack(_defender_id uuid, _target_ship_id uuid, _damage integer, _damage_dealt integer, _attacker_won boolean, _xp_gain integer DEFAULT 0)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _id uuid; _xp int; _def_prot timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;

  -- Block if defender is shielded
  SELECT protection_until INTO _def_prot FROM public.profiles WHERE id = _defender_id;
  IF _def_prot IS NOT NULL AND _def_prot > now() THEN
    RAISE EXCEPTION 'defender_protected';
  END IF;

  -- Attacker forfeits their own shield by attacking
  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = _uid AND protection_until IS NOT NULL AND protection_until > now();

  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;
  _xp := GREATEST(0, LEAST(COALESCE(_xp_gain, 0), 2000));
  IF _xp > 0 THEN
    PERFORM public._mutate_currency(_uid, 0, 0, 0, _xp);
  END IF;
  RETURN _id;
END $function$;

CREATE OR REPLACE FUNCTION public.record_attack(_defender_id uuid, _target_ship_id uuid, _damage integer, _damage_dealt integer, _attacker_won boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _id uuid; _def_prot timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _defender_id IS NULL OR _defender_id = _uid THEN RAISE EXCEPTION 'invalid defender'; END IF;
  IF _damage < 0 OR _damage > 10000000 THEN RAISE EXCEPTION 'bad damage'; END IF;
  IF _damage_dealt < 0 OR _damage_dealt > _damage THEN _damage_dealt := _damage; END IF;

  SELECT protection_until INTO _def_prot FROM public.profiles WHERE id = _defender_id;
  IF _def_prot IS NOT NULL AND _def_prot > now() THEN
    RAISE EXCEPTION 'defender_protected';
  END IF;

  UPDATE public.profiles
     SET protection_until = NULL
   WHERE id = _uid AND protection_until IS NOT NULL AND protection_until > now();

  INSERT INTO public.attacks(attacker_id, defender_id, target_ship_id, damage, damage_dealt, attacker_won, loot_coins)
    VALUES (_uid, _defender_id, _target_ship_id, _damage, _damage_dealt, _attacker_won, 0)
    RETURNING id INTO _id;
  RETURN _id;
END $function$;

-- Ad bomb: also drop attacker's own shield when used
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

  SELECT protection_until INTO _prot FROM public.profiles WHERE id = _target_id;
  IF _prot IS NOT NULL AND _prot > now() THEN RAISE EXCEPTION 'protected'; END IF;

  -- Attacker forfeits their own shield by attacking
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
    SET hp = 0, destroyed_at = now(), repair_ends_at = now() + interval '6 hours',
        at_sea = false, fishing_started_at = NULL,
        stealing_target_user_id = NULL, stealing_target_ship_id = NULL, stealing_ends_at = NULL
    WHERE user_id = _target_id AND destroyed_at IS NULL
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
  UPDATE public.profiles
    SET last_destroyer_id = _attacker,
        last_destroyer_name = COALESCE(_attacker_name, 'لاعب'),
        last_destroyer_kind = 'ad_bomb',
        last_destroyer_at = now()
   WHERE id = _target_id;

  INSERT INTO public.ad_bombs (target_user_id, attacker_id, video_key, expires_at)
  VALUES (_target_id, _attacker, _video_key, now() + interval '1 hour')
  RETURNING id INTO _new_id;

  INSERT INTO public.global_banners(kind, attacker_id, attacker_name, target_id, target_name, message, emoji)
  VALUES ('ad_bomb', _attacker, COALESCE(_attacker_name, 'لاعب'), _target_id, COALESCE(_target_name, 'لاعب'), NULL, '📺');

  RETURN _new_id;
END;
$function$;