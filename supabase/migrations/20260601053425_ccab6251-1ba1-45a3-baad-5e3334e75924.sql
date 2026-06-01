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
BEGIN
  IF _attacker IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _attacker = _target_id THEN RAISE EXCEPTION 'cannot target self'; END IF;
  IF _video_key IS NULL OR length(_video_key) = 0 THEN RAISE EXCEPTION 'video required'; END IF;

  -- Consume one ad_bomb from attacker's inventory
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

  -- Destroy ALL active ships of the target with a real repair timer (6 hours)
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
    'تم تفجير قنبلة إعلانية على محيطك! دُمّرت ' || _ships_hit || ' سفينة ووقت الإصلاح 6 ساعات. ادفع 150 جوهرة لإزالة الإعلان.',
    'attack',
    _attacker
  );

  RETURN _new_id;
END;
$function$;